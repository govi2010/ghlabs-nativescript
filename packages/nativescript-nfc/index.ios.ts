import { NdefListenerOptions, NfcApi, NfcNdefData, NfcNdefRecord, NfcTagData, NfcUriProtocols, WriteTagOptions } from './common';

declare const NFCManager: any;

// NFCResult interface from the Swift bridge
export interface NFCResult {
  success: boolean;
  message: string;
  url?: string;
  text?: string;
  raw?: string;
  errorCode?: string;
}

// NFCManager native interface
interface NFCManagerInstance {
  init(): NFCManagerInstance;
  scanWithCallback(callback: (jsonResult: string) => void): void;
  writeWithUrlCallbackCallback(url: string, callback: (jsonResult: string) => void): void;
  stopSession(): void;
  isAvailable(): boolean;
  getIsSessionActive(): boolean;
}

export interface NfcSessionInvalidator {
  invalidateSession(): void;
}

export class Nfc implements NfcApi, NfcSessionInvalidator {
  private session: NFCNDEFReaderSession;
  private delegate: NFCNDEFReaderSessionDelegateImpl;
  private nativeManager: NFCManagerInstance | null = null;

  constructor() {
    this.initializeNativeManager();
  }

  /**
   * Initialize the native NFCManager instance
   */
  private initializeNativeManager(): void {
    try {
      if (typeof NFCManager !== 'undefined') {
        this.nativeManager = NFCManager.alloc().init();
        console.log('[Nfc] Native NFCManager initialized');
      } else {
        console.warn('[Nfc] NFCManager class not found - falling back to delegate implementation');
      }
    } catch (error) {
      console.error('[Nfc] Failed to initialize NFCManager:', error);
    }
  }

  private static _available(): boolean {
    const isIOS11OrUp = NSObject.instancesRespondToSelector('accessibilityAttributedLabel');
    if (isIOS11OrUp) {
      try {
        return NFCNDEFReaderSession.readingAvailable;
      } catch (e) {
        console.error('[NFC] Error checking availability:', e);
        return false;
      }
    } else {
      return false;
    }
  }

  public available(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      // Try native manager first, then fall back to static check
      if (this.nativeManager) {
        try {
          resolve(this.nativeManager.isAvailable());
          return;
        } catch (e) {
          console.error('[Nfc] Error checking native availability:', e);
        }
      }
      resolve(Nfc._available());
    });
  }

  public enabled(): Promise<boolean> {
    return this.available();
  }

  public setOnTagDiscoveredListener(callback: (data: NfcTagData) => void): Promise<any> {
    return new Promise((resolve, reject) => {
      // Not implemented for tag discovery - only NDEF
      resolve(true);
    });
  }

  public setOnNdefDiscoveredListener(callback: (data: NfcNdefData) => void, options?: NdefListenerOptions): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!Nfc._available()) {
        reject('NFC not available');
        return;
      }

      if (callback === null) {
        this.invalidateSession();
        resolve(true);
        return;
      }

      // If native manager is available, use it with better error handling
      if (this.nativeManager) {
        try {
          this.nativeManager.scanWithCallback((jsonResult: string) => {
            try {
              const result: NFCResult = JSON.parse(jsonResult);

              if (result.success) {
                // Convert NFCResult to NfcNdefData format
                const ndefData: NfcNdefData = {
                  message: this.parseResultToNdefRecords(result),
                };

                // Execute callback on main thread
                Promise.resolve().then(() => callback(ndefData));
              } else {
                console.log('[Nfc] Scan failed:', result.message, result.errorCode);
              }
            } catch (parseError) {
              console.error('[Nfc] Failed to parse result:', parseError);
            }
          });

          resolve(true);
          return;
        } catch (e) {
          console.error('[NFC] Error using native manager, falling back to delegate:', e);
        }
      }

      // Fallback to delegate implementation
      try {
        this.delegate = NFCNDEFReaderSessionDelegateImpl.createWithOwnerResultCallbackAndOptions(
          new WeakRef(this),
          (data) => {
            if (!callback) {
              console.log('[NFC] Ndef discovered, but no listener was set. Data: ' + JSON.stringify(data));
            } else {
              // execute on the main thread with this trick, so UI updates are not broken
              Promise.resolve().then(() => callback(data));
            }
          },
          options,
        );

        this.session = NFCNDEFReaderSession.alloc().initWithDelegateQueueInvalidateAfterFirstRead(this.delegate, null, options && options.stopAfterFirstRead);

        if (options && options.scanHint) {
          this.session.alertMessage = options.scanHint;
        }

        this.session.beginSession();

        resolve(true);
      } catch (e) {
        console.error('[NFC] Error setting up listener:', e);
        reject(e);
      }
    });
  }

  /**
   * Parse NFCResult to NDEF records array
   */
  private parseResultToNdefRecords(result: NFCResult): Array<NfcNdefRecord> {
    const records: Array<NfcNdefRecord> = [];

    // Create URL record if available
    if (result.url) {
      records.push({
        id: [],
        tnf: 1, // Well-known
        type: 85, // URI
        payload: result.url,
        payloadAsHexString: this.stringToHex(result.url),
        payloadAsStringWithPrefix: result.url,
        payloadAsString: result.url,
      });
    }

    // Create text record if available
    if (result.text) {
      records.push({
        id: [],
        tnf: 1, // Well-known
        type: 84, // Text
        payload: result.text,
        payloadAsHexString: this.stringToHex(result.text),
        payloadAsStringWithPrefix: result.text,
        payloadAsString: result.text,
      });
    }

    return records;
  }

  private stringToHex(str: string): string {
    let hex = '';
    for (let i = 0; i < str.length; i++) {
      const charCode = str.charCodeAt(i);
      hex += charCode.toString(16).padStart(2, '0');
    }
    return hex;
  }

  invalidateSession(): void {
    // Stop native manager session if available
    if (this.nativeManager) {
      try {
        this.nativeManager.stopSession();
      } catch (e) {
        console.error('[Nfc] Error stopping native session:', e);
      }
    }

    // Also invalidate delegate session if exists
    if (this.session) {
      this.session.invalidateSession();
      this.session = undefined;
    }
  }

  public stopListening(): Promise<any> {
    return new Promise((resolve, reject) => {
      this.invalidateSession();
      resolve(true);
    });
  }

  public writeTag(arg: WriteTagOptions): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.nativeManager) {
        reject('NFC write not available - native manager not initialized');
        return;
      }

      // Extract URL from records
      let urlToWrite: string | null = null;

      if (arg.uriRecords && arg.uriRecords.length > 0) {
        urlToWrite = arg.uriRecords[0].uri;
      } else if (arg.textRecords && arg.textRecords.length > 0) {
        // If only text records, we can't write with the current Swift implementation
        reject('Writing text records not supported. Please provide a URI record.');
        return;
      }

      if (!urlToWrite) {
        reject('No URI record provided for writing');
        return;
      }

      console.log('[Nfc] Writing URL:', urlToWrite);

      try {
        this.nativeManager.writeWithUrlCallbackCallback(urlToWrite, (jsonResult: string) => {
          try {
            const result: NFCResult = JSON.parse(jsonResult);

            if (result.success) {
              resolve({ success: true, message: result.message });
            } else {
              reject(result.message);
            }
          } catch (parseError) {
            console.error('[Nfc] Failed to parse write result:', parseError);
            reject(`Failed to parse result: ${jsonResult}`);
          }
        });
      } catch (error: any) {
        console.error('[Nfc] Write error:', error);
        reject(`Write error: ${error?.message || error}`);
      }
    });
  }

  public eraseTag(): Promise<any> {
    return new Promise((resolve, reject) => {
      reject('Erase tag not available on iOS');
    });
  }
}

@NativeClass()
class NFCNDEFReaderSessionDelegateImpl extends NSObject implements NFCNDEFReaderSessionDelegate {
  public static ObjCProtocols = [];

  private _owner: WeakRef<NfcSessionInvalidator>;
  private resultCallback: (message: any) => void;
  private options?: NdefListenerOptions;

  public static new(): NFCNDEFReaderSessionDelegateImpl {
    try {
      NFCNDEFReaderSessionDelegateImpl.ObjCProtocols.push(NFCNDEFReaderSessionDelegate);
    } catch (ignore) {}
    return <NFCNDEFReaderSessionDelegateImpl>super.new();
  }

  public static createWithOwnerResultCallbackAndOptions(owner: WeakRef<NfcSessionInvalidator>, callback: (message: any) => void, options?: NdefListenerOptions): NFCNDEFReaderSessionDelegateImpl {
    let delegate = <NFCNDEFReaderSessionDelegateImpl>NFCNDEFReaderSessionDelegateImpl.new();
    delegate._owner = owner;
    delegate.options = options;
    delegate.resultCallback = callback;
    return delegate;
  }

  readerSessionDidBecomeActive(session: NFCNDEFReaderSession): void {
    console.log('[NFC] Session active - ready to scan');
  }

  // Called when the reader session finds a new tag (iOS 11-12)
  readerSessionDidDetectNDEFs(session: NFCNDEFReaderSession, messages: NSArray<NFCNDEFMessage>): void {
    console.log('[NFC] NDEF detected (iOS 11-12 method)');
    const firstMessage = messages[0];

    if (this.options && this.options.stopAfterFirstRead) {
      setTimeout(() => {
        debugger;
        this._owner.get().invalidateSession();
      });
    }

    // execute on the main thread with this trick
    this.resultCallback(NFCNDEFReaderSessionDelegateImpl.ndefToJson(firstMessage));
  }

  // Called when the reader session finds a new tag (iOS 13+)
  readerSessionDidDetectTags(session: NFCNDEFReaderSession, tags: NSArray<NFCNDEFTag> | NFCNDEFTag[]): void {
    console.log('[NFC] Tag detected (iOS 13+ method)');

    try {
      const tag = Array.isArray(tags) ? tags[0] : tags.objectAtIndex(0);

      // Connect to the tag
      (session as any).connectToTagCompletionHandler(tag, (error: NSError) => {
        if (error) {
          console.error('[NFC] Connection error:', error.localizedDescription);
          session.alertMessage = 'Failed to connect to tag';
          session.invalidateSession();
          return;
        }

        console.log('[NFC] Connected to tag, querying NDEF status...');

        // Query NDEF status and read message
        tag.queryNDEFStatusWithCompletionHandler((status: number, capacity: number, statusError: NSError) => {
          if (statusError) {
            console.error('[NFC] Query error:', statusError.localizedDescription);
            session.alertMessage = 'Failed to query tag';
            session.invalidateSession();
            return;
          }

          console.log('[NFC] NDEF status:', status, 'capacity:', capacity);

          // NFCNDEFStatusNotSupported = 1, NFCNDEFStatusReadWrite = 2, NFCNDEFStatusReadOnly = 3
          if (status === 1) {
            console.log('[NFC] Tag does not support NDEF');
            session.alertMessage = 'Tag does not support NDEF';
            session.invalidateSession();
            return;
          }

          // Read NDEF message
          tag.readNDEF((message: NFCNDEFMessage, readError: NSError) => {
            if (readError) {
              console.error('[NFC] Read error:', readError.localizedDescription);
              session.alertMessage = 'Failed to read tag';
              session.invalidateSession();
              return;
            }

            if (!message) {
              console.log('[NFC] Tag is empty');
              session.alertMessage = 'Tag is empty';
              session.invalidateSession();
              return;
            }

            console.log('[NFC] Tag read successfully');
            session.alertMessage = 'Tag read successfully!';

            // Invalidate session if needed
            if (this.options && this.options.stopAfterFirstRead) {
              setTimeout(() => {
                session.invalidateSession();
              }, 500);
            }

            // Send data to callback
            this.resultCallback(NFCNDEFReaderSessionDelegateImpl.ndefToJson(message));
          });
        });
      });
    } catch (e) {
      console.error('[NFC] Exception:', e);
      session.alertMessage = 'Error processing tag';
      session.invalidateSession();
    }
  }

  // Called when the reader session becomes invalid due to the specified error
  readerSessionDidInvalidateWithError(session: any /* NFCNDEFReaderSession */, error: NSError): void {
    if (error) {
      console.error('[NFC] Session invalidated:', error.localizedDescription, 'Code:', error.code);
    }
    this._owner.get().invalidateSession();
  }

  private static ndefToJson(message: NFCNDEFMessage): NfcNdefData {
    if (message === null) {
      return null;
    }

    return {
      message: NFCNDEFReaderSessionDelegateImpl.messageToJSON(message),
    };
  }

  private static messageToJSON(message: NFCNDEFMessage): Array<NfcNdefRecord> {
    const result = [];
    for (let i = 0; i < message.records.count; i++) {
      result.push(NFCNDEFReaderSessionDelegateImpl.recordToJSON(message.records.objectAtIndex(i)));
    }
    return result;
  }

  private static recordToJSON(record: NFCNDEFPayload): NfcNdefRecord {
    let payloadAsHexArray = NFCNDEFReaderSessionDelegateImpl.nsdataToHexArray(record.payload);
    let payloadAsString = NFCNDEFReaderSessionDelegateImpl.nsdataToASCIIString(record.payload);
    let payloadAsStringWithPrefix = payloadAsString;
    const recordType = NFCNDEFReaderSessionDelegateImpl.nsdataToHexArray(record.type);
    const decimalType = NFCNDEFReaderSessionDelegateImpl.hexToDec(recordType[0]);

    if (decimalType === 84) {
      // Text record
      let languageCodeLength: number = +payloadAsHexArray[0];
      payloadAsString = payloadAsStringWithPrefix.substring(languageCodeLength + 1);
    } else if (decimalType === 85) {
      // URI record
      let prefix = NfcUriProtocols[payloadAsHexArray[0]];
      if (!prefix) {
        prefix = '';
      }
      payloadAsString = prefix + payloadAsString.slice(1);
    }

    return {
      tnf: record.typeNameFormat, // "typeNameFormat" (1 = well known) - see https://developer.apple.com/documentation/corenfc/nfctypenameformat?changes=latest_major&language=objc
      type: decimalType,
      id: NFCNDEFReaderSessionDelegateImpl.hexToDecArray(NFCNDEFReaderSessionDelegateImpl.nsdataToHexArray(record.identifier)),
      payload: NFCNDEFReaderSessionDelegateImpl.hexToDecArray(payloadAsHexArray),
      payloadAsHexString: NFCNDEFReaderSessionDelegateImpl.nsdataToHexString(record.payload),
      payloadAsStringWithPrefix: payloadAsStringWithPrefix,
      payloadAsString: payloadAsString,
    };
  }

  private static hexToDec(hex) {
    if (hex === undefined) {
      return undefined;
    }

    let result = 0,
      digitValue;
    hex = hex.toLowerCase();
    for (let i = 0; i < hex.length; i++) {
      digitValue = '0123456789abcdefgh'.indexOf(hex[i]);
      result = result * 16 + digitValue;
    }
    return result;
  }

  private static buf2hexString(buffer) {
    // buffer is an ArrayBuffer
    return Array.prototype.map.call(new Uint8Array(buffer), (x) => ('00' + x.toString(16)).slice(-2)).join('');
  }

  private static buf2hexArray(buffer) {
    // buffer is an ArrayBuffer
    return Array.prototype.map.call(new Uint8Array(buffer), (x) => ('00' + x.toString(16)).slice(-2));
  }

  private static buf2hexArrayNr(buffer) {
    // buffer is an ArrayBuffer
    return Array.prototype.map.call(new Uint8Array(buffer), (x) => +x.toString(16));
  }

  private static hex2a(hexx) {
    const hex = hexx.toString(); // force conversion
    let str = '';
    for (let i = 0; i < hex.length; i += 2) str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    return str;
  }

  private static nsdataToHexString(data): string {
    let b = interop.bufferFromData(data);
    return NFCNDEFReaderSessionDelegateImpl.buf2hexString(b);
  }

  private static nsdataToHexArray(data): Array<string> {
    let b = interop.bufferFromData(data);
    return NFCNDEFReaderSessionDelegateImpl.buf2hexArray(b);
  }

  private static nsdataToASCIIString(data): string {
    return NFCNDEFReaderSessionDelegateImpl.hex2a(NFCNDEFReaderSessionDelegateImpl.nsdataToHexString(data));
  }

  private static hexToDecArray(hexArray): any {
    let resultArray = [];
    for (let i = 0; i < hexArray.length; i++) {
      let result = 0,
        digitValue;
      const hex = hexArray[i].toLowerCase();
      for (let j = 0; j < hex.length; j++) {
        digitValue = '0123456789abcdefgh'.indexOf(hex[j]);
        result = result * 16 + digitValue;
      }
      resultArray.push(result);
    }
    return JSON.stringify(resultArray);
  }
}

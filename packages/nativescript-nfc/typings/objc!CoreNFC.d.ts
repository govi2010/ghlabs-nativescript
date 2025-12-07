/**
 * iOS CoreNFC Framework Type Definitions for NativeScript
 * https://developer.apple.com/documentation/corenfc
 */

declare class NFCNDEFReaderSession extends NSObject {
  static alloc(): NFCNDEFReaderSession;

  static readonly readingAvailable: boolean;

  initWithDelegateQueueInvalidateAfterFirstRead(delegate: NFCNDEFReaderSessionDelegate, queue: any, invalidateAfterFirstRead: boolean): NFCNDEFReaderSession;

  alertMessage: string;

  beginSession(): void;

  invalidateSession(): void;
}

interface NFCNDEFReaderSessionDelegate extends NSObjectProtocol {
  readerSessionDidBecomeActive?(session: NFCNDEFReaderSession): void;

  readerSessionDidDetectNDEFs?(session: NFCNDEFReaderSession, messages: NSArray<NFCNDEFMessage>): void;

  readerSessionDidInvalidateWithError(session: NFCNDEFReaderSession, error: NSError): void;
}

declare var NFCNDEFReaderSessionDelegate: {
  prototype: NFCNDEFReaderSessionDelegate;
};

declare class NFCNDEFMessage extends NSObject {
  static alloc(): NFCNDEFMessage;

  readonly records: NSArray<NFCNDEFPayload>;

  initWithNDEFRecords(records: NSArray<NFCNDEFPayload> | NFCNDEFPayload[]): NFCNDEFMessage;
}

declare class NFCNDEFPayload extends NSObject {
  static alloc(): NFCNDEFPayload;

  readonly typeNameFormat: number;
  readonly type: NSData;
  readonly identifier: NSData;
  readonly payload: NSData;

  static wellKnownTypeTextPayloadWithStringLocale(text: string, locale: NSLocale): NFCNDEFPayload;
}

declare class NFCNDEFTag extends NSObject {
  writeNDEFCompletionHandler?(message: NFCNDEFMessage, completionHandler: (error: NSError) => void): void;
}

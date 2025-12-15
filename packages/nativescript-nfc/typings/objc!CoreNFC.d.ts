/**
 * iOS CoreNFC Framework Type Definitions for NativeScript
 * https://developer.apple.com/documentation/corenfc
 */

/**
 * @since 11.0
 */
declare class NFCReaderSession extends NSObject implements NFCReaderSessionProtocol {
  static alloc(): NFCReaderSession; // inherited from NSObject

  static new(): NFCReaderSession; // inherited from NSObject

  /**
   * @since 11.0
   */
  readonly delegate: any;

  /**
   * @since 11.0
   */
  readonly sessionQueue: NSObject & OS_dispatch_queue;

  /**
   * @since 11.0
   */
  static readonly readingAvailable: boolean;

  /**
   * @since 11.0
   */
  alertMessage: string; // inherited from NFCReaderSessionProtocol

  readonly debugDescription: string; // inherited from NSObjectProtocol

  readonly description: string; // inherited from NSObjectProtocol

  readonly hash: number; // inherited from NSObjectProtocol

  readonly isProxy: boolean; // inherited from NSObjectProtocol

  /**
   * @since 11.0
   */
  readonly ready: boolean; // inherited from NFCReaderSessionProtocol

  readonly superclass: typeof NSObject; // inherited from NSObjectProtocol

  readonly; // inherited from NSObjectProtocol

  /**
   * @since 11.0
   */
  beginSession(): void;

  class(): typeof NSObject;

  conformsToProtocol(aProtocol: any /* Protocol */): boolean;

  /**
   * @since 11.0
   */
  invalidateSession(): void;

  /**
   * @since 13.0
   */
  invalidateSessionWithErrorMessage(errorMessage: string): void;

  isEqual(object: any): boolean;

  isKindOfClass(aClass: typeof NSObject): boolean;

  isMemberOfClass(aClass: typeof NSObject): boolean;

  performSelector(aSelector: string): any;

  performSelectorWithObject(aSelector: string, object: any): any;

  performSelectorWithObjectWithObject(aSelector: string, object1: any, object2: any): any;

  respondsToSelector(aSelector: string): boolean;

  retainCount(): number;

  self(): this;
}
declare class NFCNDEFReaderSession extends NFCReaderSession {
  static alloc(): NFCNDEFReaderSession; // inherited from NSObject

  static new(): NFCNDEFReaderSession; // inherited from NSObject

  /**
   * @since 11.0
   */
  constructor(o: { delegate: NFCNDEFReaderSessionDelegate; queue: NSObject & OS_dispatch_queue; invalidateAfterFirstRead: boolean });

  /**
   * @since 13.0
   */
  connectToTagCompletionHandler(tag: NFCNDEFTag, completionHandler: (p1: NSError) => void): void;

  /**
   * @since 11.0
   */
  initWithDelegateQueueInvalidateAfterFirstRead(delegate: NFCNDEFReaderSessionDelegate, queue: NSObject & OS_dispatch_queue, invalidateAfterFirstRead: boolean): this;

  /**
   * @since 13.0
   */
  restartPolling(): void;
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

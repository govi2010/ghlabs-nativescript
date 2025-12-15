import Foundation
import CoreNFC

@objcMembers
@objc(NFCManager)
public class NFCManager: NSObject, NFCNDEFReaderSessionDelegate {

    // MARK: - Types

    enum NFCSessionMode {
        case scan
        case write
    }

    enum NFCBridgeError: Error {
        case recordCreation(String)
        case invalidUrl(String)
    }

    // MARK: - Properties

    private var readerSession: NFCNDEFReaderSession?
    private var sessionMode: NFCSessionMode = .scan

    // Data to write (set from TypeScript)
    private var writeUrl: String?

    // Callback to TypeScript - MUST be called in ALL cases
    private var resultCallback: ((String) -> Void)?

    // Track if we've already emitted result (prevent double callbacks)
    private var hasEmittedResult: Bool = false

    // Track if session is active
    private var isSessionActive: Bool = false

    // MARK: - Public API (Callable from TypeScript)

    /// Scan NFC tag and return detected URL/Text in callback as JSON string
    /// TS: manager.scanWithCallback((json) => {})
    @objc public func scanWithCallback(_ callback: @escaping (String) -> Void) {
        log("scanWithCallback called")

        // Reset state for new operation
        resetState()

        self.resultCallback = callback
        self.writeUrl = nil
        startSession(mode: .scan)
    }

    /// Write URL from TS into tag as well-known URI record
    /// TS: manager.writeWithUrlCallback(url, (json) => {})
    @objc public func writeWithUrlCallback(_ url: String, callback: @escaping (String) -> Void) {
        log("writeWithUrlCallback called, url=\(url)")

        // Reset state for new operation
        resetState()

        self.resultCallback = callback
        self.writeUrl = url
        startSession(mode: .write)
    }

    /// Stop/invalidate the current NFC session and emit cancelled result
    /// TS: manager.stopSession()
    @objc public func stopSession() {
        log("stopSession called from TypeScript")

        // Emit cancelled result if we haven't emitted anything yet
        if !hasEmittedResult && resultCallback != nil {
            emitResult(
                success: false,
                message: "Session stopped by user.",
                url: nil,
                text: nil,
                raw: nil,
                errorCode: "USER_STOPPED"
            )
        }

        cleanupSession()
    }

    /// Check if NFC is available on this device
    /// TS: manager.isAvailable()
    @objc public func isAvailable() -> Bool {
        return NFCNDEFReaderSession.readingAvailable
    }

    /// Check if a session is currently active
    /// TS: manager.isSessionActive()
    @objc public func getIsSessionActive() -> Bool {
        return isSessionActive
    }

    // MARK: - Reset State

    private func resetState() {
        hasEmittedResult = false
        isSessionActive = false
    }

    // MARK: - Session control

    private func startSession(mode: NFCSessionMode) {
        // Clean up any existing session first
        if readerSession != nil {
            log("Cleaning up existing session before starting new one")
            readerSession?.invalidate()
            readerSession = nil
        }

        // Check NFC availability
        guard NFCNDEFReaderSession.readingAvailable else {
            logError("NFC not supported / readingAvailable=false")
            emitResult(
                success: false,
                message: "NFC not supported on this device.",
                url: nil,
                text: nil,
                raw: nil,
                errorCode: "NFC_NOT_AVAILABLE"
            )
            return
        }

        self.sessionMode = mode
        self.hasEmittedResult = false

        // Create new session
        readerSession = NFCNDEFReaderSession(
            delegate: self,
            queue: DispatchQueue.main,
            invalidateAfterFirstRead: false  // We control invalidation
        )

        guard readerSession != nil else {
            logError("Failed to create NFCNDEFReaderSession")
            emitResult(
                success: false,
                message: "Failed to create NFC session.",
                url: nil,
                text: nil,
                raw: nil,
                errorCode: "SESSION_CREATE_FAILED"
            )
            return
        }

        readerSession?.alertMessage = (mode == .scan)
        ? "Hold your iPhone near the NFC tag to scan."
        : "Hold your iPhone near the NFC tag to write."

        log("Beginning NFC session, mode=\(mode == .scan ? "scan" : "write")")
        isSessionActive = true
        readerSession?.begin()
    }

    /// Clean up session and reset state
    private func cleanupSession() {
        log("Cleaning up session...")

        if let session = readerSession {
            session.invalidate()
        }

        readerSession = nil
        isSessionActive = false

        log("Session cleanup complete")
    }

    // MARK: - Delegate methods

    /// Called when session is invalidated (by error, user cancel, or programmatically)
    /// THIS IS THE KEY METHOD - must handle ALL invalidation cases
    public func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        log("didInvalidateWithError: \(error)")

        // Clear session reference
        readerSession = nil
        isSessionActive = false

        // Determine error type and emit appropriate result
        if let readerError = error as? NFCReaderError {
            switch readerError.code {
            case .readerSessionInvalidationErrorUserCanceled:
                // User tapped "Cancel" button
                log("User cancelled the session")
                emitResultIfNeeded(
                    success: false,
                    message: "Cancelled by user.",
                    url: nil,
                    text: nil,
                    raw: nil,
                    errorCode: "USER_CANCELLED"
                )

            case .readerSessionInvalidationErrorFirstNDEFTagRead:
                // This is normal completion for invalidateAfterFirstRead=true
                // We shouldn't hit this since we set it to false
                log("Session completed after first read (normal)")
            // Don't emit here - result was already emitted in didDetect

            case .readerSessionInvalidationErrorSessionTimeout:
                // Session timed out (60 seconds default)
                log("Session timed out")
                emitResultIfNeeded(
                    success: false,
                    message: "Session timed out. Please try again.",
                    url: nil,
                    text: nil,
                    raw: nil,
                    errorCode: "SESSION_TIMEOUT"
                )

            case .readerSessionInvalidationErrorSessionTerminatedUnexpectedly:
                // System terminated the session
                log("Session terminated unexpectedly")
                emitResultIfNeeded(
                    success: false,
                    message: "Session terminated unexpectedly.",
                    url: nil,
                    text: nil,
                    raw: nil,
                    errorCode: "SESSION_TERMINATED"
                )

            case .readerSessionInvalidationErrorSystemIsBusy:
                // Another app or system is using NFC
                log("System NFC is busy")
                emitResultIfNeeded(
                    success: false,
                    message: "NFC is busy. Please try again.",
                    url: nil,
                    text: nil,
                    raw: nil,
                    errorCode: "SYSTEM_BUSY"
                )

            case .readerTransceiveErrorTagConnectionLost:
                // Tag was moved away during operation
                log("Tag connection lost")
                emitResultIfNeeded(
                    success: false,
                    message: "Tag connection lost. Hold steady and try again.",
                    url: nil,
                    text: nil,
                    raw: nil,
                    errorCode: "CONNECTION_LOST"
                )

            case .readerTransceiveErrorTagResponseError:
                // Tag returned an error
                log("Tag response error")
                emitResultIfNeeded(
                    success: false,
                    message: "Tag response error.",
                    url: nil,
                    text: nil,
                    raw: nil,
                    errorCode: "TAG_RESPONSE_ERROR"
                )

            case .readerTransceiveErrorTagNotConnected:
                // Tag not connected
                log("Tag not connected")
                emitResultIfNeeded(
                    success: false,
                    message: "Tag not connected.",
                    url: nil,
                    text: nil,
                    raw: nil,
                    errorCode: "TAG_NOT_CONNECTED"
                )

            case .readerTransceiveErrorPacketTooLong:
                // Data too large for tag
                log("Packet too long for tag")
                emitResultIfNeeded(
                    success: false,
                    message: "Data too large for this tag.",
                    url: nil,
                    text: nil,
                    raw: nil,
                    errorCode: "PACKET_TOO_LONG"
                )

            case .readerTransceiveErrorRetryExceeded:
                // Too many retries
                log("Retry exceeded")
                emitResultIfNeeded(
                    success: false,
                    message: "Communication failed after retries.",
                    url: nil,
                    text: nil,
                    raw: nil,
                    errorCode: "RETRY_EXCEEDED"
                )

            case .ndefReaderSessionErrorTagNotWritable:
                // Tag is not writable
                log("Tag not writable")
                emitResultIfNeeded(
                    success: false,
                    message: "Tag is not writable.",
                    url: nil,
                    text: nil,
                    raw: nil,
                    errorCode: "TAG_NOT_WRITABLE"
                )

            case .ndefReaderSessionErrorTagUpdateFailure:
                // Failed to write to tag
                log("Tag update failure")
                emitResultIfNeeded(
                    success: false,
                    message: "Failed to write to tag.",
                    url: nil,
                    text: nil,
                    raw: nil,
                    errorCode: "TAG_UPDATE_FAILURE"
                )

            case .ndefReaderSessionErrorTagSizeTooSmall:
                // Tag capacity too small
                log("Tag size too small")
                emitResultIfNeeded(
                    success: false,
                    message: "Tag capacity is too small for this data.",
                    url: nil,
                    text: nil,
                    raw: nil,
                    errorCode: "TAG_SIZE_TOO_SMALL"
                )

            case .ndefReaderSessionErrorZeroLengthMessage:
                // Empty message
                log("Zero length message")
                emitResultIfNeeded(
                    success: false,
                    message: "Tag contains empty message.",
                    url: nil,
                    text: nil,
                    raw: nil,
                    errorCode: "ZERO_LENGTH_MESSAGE"
                )

            @unknown default:
                // Unknown error type
                log("Unknown NFC error: \(readerError.code.rawValue)")
                emitResultIfNeeded(
                    success: false,
                    message: "NFC error: \(error.localizedDescription)",
                    url: nil,
                    text: nil,
                    raw: nil,
                    errorCode: "UNKNOWN_NFC_ERROR"
                )
            }
        } else {
            // Non-NFC error
            log("Non-NFC error: \(error.localizedDescription)")
            emitResultIfNeeded(
                success: false,
                message: "Error: \(error.localizedDescription)",
                url: nil,
                text: nil,
                raw: nil,
                errorCode: "UNKNOWN_ERROR"
            )
        }
    }

    public func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {
        // This is called for invalidateAfterFirstRead=true, which we're not using
        log("didDetectNDEFs called (ignored since we use didDetect tags), count=\(messages.count)")
    }

    public func readerSession(_ session: NFCNDEFReaderSession, didDetect tags: [NFCNDEFTag]) {
        log("didDetect tags, count=\(tags.count)")

        let retryInterval = DispatchTimeInterval.milliseconds(500)

        // Handle multiple tags
        if tags.count > 1 {
            session.alertMessage = "More than 1 tag detected. Remove extra tags and try again."
            logError("Multiple tags detected, restarting polling")
            DispatchQueue.global().asyncAfter(deadline: .now() + retryInterval) {
                session.restartPolling()
            }
            return
        }

        // Handle no tags
        guard let tag = tags.first else {
            session.alertMessage = "No tag found. Try again."
            logError("No tag in array, restarting polling")
            DispatchQueue.global().asyncAfter(deadline: .now() + retryInterval) {
                session.restartPolling()
            }
            return
        }

        // Process the tag
        Task {
            await processTag(tag: tag, session: session)
        }
    }

    // MARK: - Process Tag

    private func processTag(tag: NFCNDEFTag, session: NFCNDEFReaderSession) async {
        do {
            log("Connecting to tag...")
            try await session.connect(to: tag)

            let (status, capacity) = try await tag.queryNDEFStatus()
            log("NDEF status=\(status.rawValue), capacity=\(capacity) bytes")

            switch status {
            case .notSupported:
                session.alertMessage = "Tag is not NDEF compliant."
                emitAndClose(
                    session: session,
                    success: false,
                    message: "Tag is not NDEF compliant.",
                    url: nil,
                    text: nil,
                    raw: nil,
                    errorCode: "TAG_NOT_NDEF"
                )

            case .readOnly:
                if sessionMode == .scan {
                    log("Reading tag (readOnly)")
                    do {
                        let ndefMessage = try await tag.readNDEF()
                        let parsed = parseNdefMessage(ndefMessage)
                        session.alertMessage = "Scan complete!"
                        emitAndClose(
                            session: session,
                            success: true,
                            message: "Scan successful.",
                            url: parsed.url,
                            text: parsed.text,
                            raw: parsed.raw,
                            errorCode: nil
                        )
                    } catch {
                        // Handle empty tag or read error
                        log("Read error on readOnly tag: \(error.localizedDescription)")
                        session.alertMessage = "Tag appears empty or unreadable."
                        emitAndClose(
                            session: session,
                            success: false,
                            message: "Failed to read tag: \(error.localizedDescription)",
                            url: nil,
                            text: nil,
                            raw: nil,
                            errorCode: "READ_ERROR"
                        )
                    }
                } else {
                    session.alertMessage = "Tag is read-only."
                    emitAndClose(
                        session: session,
                        success: false,
                        message: "Tag is read-only; cannot write.",
                        url: nil,
                        text: nil,
                        raw: nil,
                        errorCode: "TAG_READ_ONLY"
                    )
                }

            case .readWrite:
                if sessionMode == .scan {
                    log("Reading tag (readWrite)")
                    do {
                        let ndefMessage = try await tag.readNDEF()
                        let parsed = parseNdefMessage(ndefMessage)
                        session.alertMessage = "Scan complete!"
                        emitAndClose(
                            session: session,
                            success: true,
                            message: "Scan successful.",
                            url: parsed.url,
                            text: parsed.text,
                            raw: parsed.raw,
                            errorCode: nil
                        )
                    } catch {
                        // Handle empty tag or read error
                        log("Read error on readWrite tag: \(error.localizedDescription)")
                        // Could be empty tag - return success with empty data
                        session.alertMessage = "Tag scanned (empty or no NDEF)."
                        emitAndClose(
                            session: session,
                            success: true,
                            message: "Tag scanned but appears empty.",
                            url: nil,
                            text: nil,
                            raw: nil,
                            errorCode: nil
                        )
                    }
                } else {
                    log("Writing tag (readWrite)")
                    do {
                        let ndefToWrite = try createNdefMessageForWriting()
                        try await tag.writeNDEF(ndefToWrite)
                        session.alertMessage = "Write complete!"
                        emitAndClose(
                            session: session,
                            success: true,
                            message: "Write successful.",
                            url: writeUrl,
                            text: nil,
                            raw: nil,
                            errorCode: nil
                        )
                    } catch let writeError as NFCBridgeError {
                        // Handle our custom errors
                        switch writeError {
                        case .recordCreation(let msg):
                            session.alertMessage = "Write failed."
                            emitAndClose(
                                session: session,
                                success: false,
                                message: msg,
                                url: nil,
                                text: nil,
                                raw: nil,
                                errorCode: "RECORD_CREATION_ERROR"
                            )
                        case .invalidUrl(let msg):
                            session.alertMessage = "Invalid URL."
                            emitAndClose(
                                session: session,
                                success: false,
                                message: msg,
                                url: nil,
                                text: nil,
                                raw: nil,
                                errorCode: "INVALID_URL"
                            )
                        }
                    } catch {
                        logError("Write failed: \(error.localizedDescription)")
                        session.alertMessage = "Write failed."
                        emitAndClose(
                            session: session,
                            success: false,
                            message: "Write failed: \(error.localizedDescription)",
                            url: nil,
                            text: nil,
                            raw: nil,
                            errorCode: "WRITE_ERROR"
                        )
                    }
                }

            @unknown default:
                session.alertMessage = "Unknown NDEF status."
                emitAndClose(
                    session: session,
                    success: false,
                    message: "Unknown NDEF status.",
                    url: nil,
                    text: nil,
                    raw: nil,
                    errorCode: "UNKNOWN_NDEF_STATUS"
                )
            }

        } catch {
            logError("Tag processing failed: \(error.localizedDescription)")
            session.alertMessage = "Failed to process tag."
            emitAndClose(
                session: session,
                success: false,
                message: "Failed: \(error.localizedDescription)",
                url: nil,
                text: nil,
                raw: nil,
                errorCode: "TAG_PROCESSING_ERROR"
            )
        }
    }

    // MARK: - Emit and Close Session

    /// Emit result and properly close the session
    private func emitAndClose(session: NFCNDEFReaderSession, success: Bool, message: String, url: String?, text: String?, raw: String?, errorCode: String?) {
        // Emit the result first
        emitResult(success: success, message: message, url: url, text: text, raw: raw, errorCode: errorCode)

        // Small delay to show the alert message, then invalidate
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.log("Invalidating session after operation...")
            session.invalidate()
            self?.readerSession = nil
            self?.isSessionActive = false
            self?.log("Session closed - ready for next operation")
        }
    }

    // MARK: - Create NDEF for writing

    private func createNdefMessageForWriting() throws -> NFCNDEFMessage {
        guard let urlString = writeUrl, !urlString.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw NFCBridgeError.recordCreation("No URL provided.")
        }

        guard let url = URL(string: urlString), url.scheme != nil else {
            throw NFCBridgeError.invalidUrl("Invalid URL: \(urlString)")
        }

        guard let urlPayload = NFCNDEFPayload.wellKnownTypeURIPayload(string: url.absoluteString) else {
            throw NFCBridgeError.recordCreation("Failed to create URI payload.")
        }

        // Optional: add a text record for debugging
        let text = "Written by NativeScript at \(Date())"
        let textPayload = makeTextPayload(text: text, locale: "en")

        log("Prepared write message: url=\(url.absoluteString)")
        return NFCNDEFMessage(records: [urlPayload, textPayload].compactMap { $0 })
    }

    private func makeTextPayload(text: String, locale: String) -> NFCNDEFPayload? {
        guard let langData = locale.data(using: .utf8),
        let textData = text.data(using: .utf8) else { return nil }

        var payload = Data()
        let status: UInt8 = UInt8(langData.count & 0x3F)
        payload.append(status)
        payload.append(langData)
        payload.append(textData)

        let type = "T".data(using: .utf8) ?? Data()
        return NFCNDEFPayload(format: .nfcWellKnown, type: type, identifier: Data(), payload: payload)
    }

    // MARK: - Parse NDEF

    private func parseNdefMessage(_ message: NFCNDEFMessage) -> (url: String?, text: String?, raw: String?) {
        var foundUrl: String?
        var foundText: String?
        var rawParts: [String] = []

        for record in message.records {
            switch record.typeNameFormat {
            case .nfcWellKnown:
                if let url = record.wellKnownTypeURIPayload() {
                    let s = url.absoluteString
                    rawParts.append("URL=\(s)")
                    if foundUrl == nil { foundUrl = s }
                }

                let (text, locale) = record.wellKnownTypeTextPayload()
                if let t = text, let loc = locale {
                    let s = "\(t) (locale=\(loc))"
                    rawParts.append("TEXT=\(s)")
                    if foundText == nil { foundText = t }
                }

            case .absoluteURI:
                if let s = String(data: record.payload, encoding: .utf8) {
                    rawParts.append("ABS_URI=\(s)")
                    if foundUrl == nil { foundUrl = s }
                }

            case .media:
                let typeStr = String(data: record.type, encoding: .utf8) ?? "media"
                if let s = String(data: record.payload, encoding: .utf8) {
                    rawParts.append("MEDIA(\(typeStr))=\(s)")
                } else {
                    rawParts.append("MEDIA(\(typeStr))=<binary \(record.payload.count) bytes>")
                }

            default:
                rawParts.append("OTHER(format=\(record.typeNameFormat.rawValue), bytes=\(record.payload.count))")
            }
        }

        let raw = rawParts.isEmpty ? nil : rawParts.joined(separator: " | ")
        log("Parsed NDEF => url=\(foundUrl ?? "nil"), text=\(foundText ?? "nil")")

        return (foundUrl, foundText, raw)
    }

    // MARK: - Emit result to TypeScript

    /// Emit result only if not already emitted
    private func emitResultIfNeeded(success: Bool, message: String, url: String?, text: String?, raw: String?, errorCode: String?) {
        guard !hasEmittedResult else {
            log("Result already emitted, skipping")
            return
        }
        emitResult(success: success, message: message, url: url, text: text, raw: raw, errorCode: errorCode)
    }

    /// Emit result to TypeScript callback - ALWAYS includes errorCode for error handling
    private func emitResult(success: Bool, message: String, url: String?, text: String?, raw: String?, errorCode: String?) {
        guard !hasEmittedResult else {
            log("Already emitted result, skipping duplicate")
            return
        }
        hasEmittedResult = true

        // Build payload with errorCode for TypeScript error handling
        var payload: [String: Any] = [
            "success": success,
            "message": message
        ]

        // Add optional fields
        if let url = url { payload["url"] = url }
        if let text = text { payload["text"] = text }
        if let raw = raw { payload["raw"] = raw }
        if let errorCode = errorCode { payload["errorCode"] = errorCode }

        let jsonStr: String
        do {
            let data = try JSONSerialization.data(withJSONObject: payload, options: [])
            jsonStr = String(data: data, encoding: .utf8) ?? "{\"success\":false,\"message\":\"JSON encoding failed\",\"errorCode\":\"JSON_ERROR\"}"
        } catch {
            jsonStr = "{\"success\":false,\"message\":\"JSON encode failed: \(error.localizedDescription)\",\"errorCode\":\"JSON_ERROR\"}"
        }

        DispatchQueue.main.async { [weak self] in
            self?.log("Emitting to TS: \(jsonStr)")
            self?.resultCallback?(jsonStr)

            // Clear callback after emitting to prevent memory leaks
            self?.resultCallback = nil
        }
    }

    // MARK: - Logging

    private func log(_ msg: String) {
        print("[NFCManager] \(msg)")
    }

    private func logError(_ msg: String) {
        print("[NFCManager][ERROR] \(msg)")
    }
}
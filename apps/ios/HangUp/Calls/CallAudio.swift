import AVFoundation

/// Audio for one call: the caller's voice out, the user's microphone in.
///
/// Everything plays through one AVAudioEngine with Apple's voice processing
/// turned on (the same echo canceller FaceTime uses), so the microphone hears
/// the user and not the caller coming out of the speaker. That is what lets
/// the user talk over the caller, which the web app could not do safely.
final class CallAudio {
    let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let phoneEQ = AVAudioUnitEQ(numberOfBands: 2)
    private var line: AVAudioSourceNode?
    /// Format every caller buffer is converted to before it is scheduled.
    let playFormat = AVAudioFormat(standardFormatWithSampleRate: 24_000, channels: 1)!

    /// Called on the audio thread with each microphone buffer.
    var onMicBuffer: ((AVAudioPCMBuffer) -> Void)?
    /// Called on the main thread when queued caller audio has all played.
    var onIdle: (() -> Void)?
    private(set) var outstanding = 0
    var playing: Bool { outstanding > 0 }
    private var generation = 0

    /// AVAudioSession setup for a call. CallKit activates the session itself.
    static func configureSession() {
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .allowBluetoothA2DP])
        try? s.setPreferredIOBufferDuration(0.02)
    }

    /// Builds the graph and starts it. Call after CallKit activates the audio session.
    func start(ambience: String, phoneFilter: Bool) throws {
        let input = engine.inputNode
        try input.setVoiceProcessingEnabled(true)

        // Telephone band (300 Hz to 3.4 kHz) for on-device voices so they sound like a phone line.
        let low = phoneEQ.bands[0]
        low.filterType = .highPass
        low.frequency = 300
        low.bypass = false
        let high = phoneEQ.bands[1]
        high.filterType = .lowPass
        high.frequency = 3400
        high.bypass = false
        phoneEQ.bypass = !phoneFilter

        engine.attach(player)
        engine.attach(phoneEQ)
        engine.connect(player, to: phoneEQ, format: playFormat)
        engine.connect(phoneEQ, to: engine.mainMixerNode, format: playFormat)

        let node = Self.lineNoise(level: Self.noiseLevel(ambience))
        engine.attach(node)
        engine.connect(node, to: engine.mainMixerNode, format: playFormat)
        line = node

        let micFormat = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: micFormat) { [weak self] buf, _ in
            self?.onMicBuffer?(buf)
        }
        engine.prepare()
        try engine.start()
        player.play()
    }

    func stop() {
        generation += 1
        engine.inputNode.removeTap(onBus: 0)
        player.stop()
        engine.stop()
        outstanding = 0
    }

    /// Stops caller speech now (the user talked over it).
    func interrupt() {
        generation += 1
        player.stop()
        outstanding = 0
        player.play()
        onIdle?()
    }

    func schedule(_ buffer: AVAudioPCMBuffer) {
        guard engine.isRunning, let buf = Self.convert(buffer, to: playFormat), buf.frameLength > 0 else { return }
        outstanding += 1
        let gen = generation
        player.scheduleBuffer(buf, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, gen == self.generation else { return }
                self.outstanding -= 1
                if self.outstanding == 0 { self.onIdle?() }
            }
        }
    }

    /// Decodes a WAV file (base64) sent by the server's speech service.
    func scheduleWav(base64: String) {
        guard let data = Data(base64Encoded: base64) else { return }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        defer { try? FileManager.default.removeItem(at: url) }
        do {
            try data.write(to: url)
            let file = try AVAudioFile(forReading: url)
            guard let buf = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)) else { return }
            try file.read(into: buf)
            schedule(buf)
        } catch {
            print("wav decode failed", error)
        }
    }

    static func convert(_ buf: AVAudioPCMBuffer, to fmt: AVAudioFormat) -> AVAudioPCMBuffer? {
        if buf.format == fmt { return buf }
        guard buf.frameLength > 0, let conv = AVAudioConverter(from: buf.format, to: fmt) else { return nil }
        let cap = AVAudioFrameCount(Double(buf.frameLength) * fmt.sampleRate / buf.format.sampleRate) + 1024
        guard let out = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: cap) else { return nil }
        var fed = false
        var err: NSError?
        conv.convert(to: out, error: &err) { _, status in
            if fed {
                status.pointee = .endOfStream
                return nil
            }
            fed = true
            status.pointee = .haveData
            return buf
        }
        return err == nil ? out : nil
    }

    private static func noiseLevel(_ ambience: String) -> Float {
        switch ambience {
        case "call-center": return 0.010
        case "street": return 0.012
        case "office": return 0.006
        default: return 0.003
        }
    }

    /// Soft brown noise: the hiss of a phone line under the caller.
    private static func lineNoise(level: Float) -> AVAudioSourceNode {
        var last: Float = 0
        return AVAudioSourceNode { _, _, frameCount, abl -> OSStatus in
            let buffers = UnsafeMutableAudioBufferListPointer(abl)
            for frame in 0..<Int(frameCount) {
                last = (last + 0.02 * Float.random(in: -1...1)) / 1.02
                let v = last * level * 30
                for b in buffers {
                    b.mData?.assumingMemoryBound(to: Float.self)[frame] = v
                }
            }
            return noErr
        }
    }
}

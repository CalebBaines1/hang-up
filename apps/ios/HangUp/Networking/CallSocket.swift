import Foundation

/// One live practice call over the server's WebSocket (CallSession in packages/client/src/call.ts).
final class CallSocket {
    private let task: URLSessionWebSocketTask
    var onMessage: ((ServerMessage) -> Void)?
    var onClose: (() -> Void)?
    private var closed = false

    init(url: URL) {
        task = URLSession.shared.webSocketTask(with: url)
        task.maximumMessageSize = 4 * 1024 * 1024
    }

    func connect(speech: String) {
        task.resume()
        send(["type": "start", "speech": speech])
        receive()
    }

    private func receive() {
        task.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(.string(let text)):
                if let data = text.data(using: .utf8), let msg = try? JSONDecoder().decode(ServerMessage.self, from: data) {
                    DispatchQueue.main.async { self.onMessage?(msg) }
                }
                self.receive()
            case .success:
                self.receive()
            case .failure:
                DispatchQueue.main.async { self.finish() }
            }
        }
    }

    private func finish() {
        guard !closed else { return }
        closed = true
        onClose?()
    }

    func send(_ msg: [String: Any]) {
        guard !closed, let data = try? JSONSerialization.data(withJSONObject: msg), let text = String(data: data, encoding: .utf8) else { return }
        task.send(.string(text)) { _ in }
    }

    func close() {
        closed = true
        task.cancel(with: .normalClosure, reason: nil)
    }
}

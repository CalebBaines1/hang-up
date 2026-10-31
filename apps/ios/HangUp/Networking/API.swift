import Foundation

struct APIError: LocalizedError {
    var status: Int
    var message: String
    var errorDescription: String? { message }
}

/// Swift port of HangUpApi in packages/client/src/api.ts.
final class HangUpAPI {
    var baseURL: URL
    var token: String?

    init(baseURL: URL, token: String?) {
        self.baseURL = baseURL
        self.token = token
    }

    private func request<T: Decodable>(_ method: String, _ path: String, body: [String: Any]? = nil, as: T.Type = T.self) async throws -> T {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = method
        req.timeoutInterval = 60 // a sleeping free-tier server can take a while to wake
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, res) = try await URLSession.shared.data(for: req)
        let status = (res as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw APIError(status: status, message: msg ?? HTTPURLResponse.localizedString(forStatusCode: status))
        }
        if T.self == Empty.self { return Empty() as! T }
        return try JSONDecoder().decode(T.self, from: data)
    }

    struct Empty: Decodable {}
    struct Registration: Decodable { var deviceId: String; var token: String }
    struct Ringing: Decodable { var call: CallSummary? }
    struct History: Decodable { var calls: [CallSummary] }

    func register(displayName: String) async throws -> Registration {
        try await request("POST", "/api/devices", body: ["displayName": displayName])
    }
    func me() async throws -> Me { try await request("GET", "/api/me") }
    func updateSettings(_ patch: [String: Any]) async throws -> Me { try await request("PATCH", "/api/me/settings", body: patch) }
    func opened() async throws { _ = try await request("POST", "/api/me/opened", as: Empty.self) }
    func deleteMyData() async throws { _ = try await request("DELETE", "/api/me", as: Empty.self) }
    func catalog() async throws -> Catalog { try await request("GET", "/api/scenarios") }

    func practice(scenarioId: String?, difficulty: Difficulty?) async throws -> CallSummary {
        var body: [String: Any] = [:]
        if let scenarioId { body["scenarioId"] = scenarioId }
        if let difficulty { body["difficulty"] = difficulty.rawValue }
        return try await request("POST", "/api/calls", body: body)
    }
    func ringing() async throws -> CallSummary? { try await request("GET", "/api/calls/ringing", as: Ringing.self).call }
    func decline(_ callId: String) async throws { _ = try await request("POST", "/api/calls/\(callId)/decline", as: Empty.self) }
    func history() async throws -> [CallSummary] { try await request("GET", "/api/calls", as: History.self).calls }
    func call(_ callId: String) async throws -> CallDetail { try await request("GET", "/api/calls/\(callId)") }

    func registerVoip(token: String, sandbox: Bool) async throws {
        struct R: Decodable { var enabled: Bool }
        _ = try await request("POST", "/api/push/voip", body: ["token": token, "sandbox": sandbox], as: R.self)
    }

    private func withToken(_ path: String, scheme: String? = nil) -> URL {
        var c = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if let scheme { c.scheme = scheme }
        c.queryItems = [URLQueryItem(name: "token", value: token ?? "")]
        return c.url!
    }
    func debriefAudioURL(_ callId: String) -> URL { withToken("/api/calls/\(callId)/debrief.wav") }
    func sessionURL(_ callId: String) -> URL {
        withToken("/api/calls/\(callId)/session", scheme: baseURL.scheme == "https" ? "wss" : "ws")
    }
}

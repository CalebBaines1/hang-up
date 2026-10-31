import Foundation

// Mirrors packages/client/src/types.ts. Only the fields the iPhone app uses.

enum Difficulty: String, Codable, CaseIterable, Identifiable {
    case clumsy, competent, expert
    var id: String { rawValue }
    var label: String {
        switch self {
        case .clumsy: return "Easy"
        case .competent: return "Medium"
        case .expert: return "Hard"
        }
    }
}

enum EndReason: String, Codable {
    case hungUp = "hung_up"
    case safeWord = "safe_word"
    case practiceReveal = "practice_reveal"
    case payloadGiven = "payload_given"
    case callerGaveUp = "caller_gave_up"
    case timeCap = "time_cap"
    case disconnected
}

struct VoiceHint: Codable, Equatable {
    var gender: String
    var pitch: Double
    var rate: Double
}

struct Persona: Codable, Identifiable {
    var id: String
    var name: String
    var voiceHint: VoiceHint
}

struct Scenario: Codable, Identifiable, Hashable {
    var id: String
    var title: String
    var callerId: String
    var personaId: String
    var summary: String
    var ambience: String
}

struct Catalog: Codable {
    var scenarios: [Scenario]
    var personas: [Persona]
}

struct ScheduleWindow: Codable, Equatable {
    var days: [Int]
    var start: String
    var end: String
}

struct Settings: Codable, Equatable {
    var displayName: String
    var safeWord: String
    var timezone: String
    var scheduleEnabled: Bool
    var window: ScheduleWindow
    var callsPerWeek: Int
    var familyCallsEnabled: Bool
    var consentedAt: String?
    // Real phone calls (optional so older servers still decode).
    var phoneNumber: String?
    var phoneVerifiedAt: String?
    var ringPhone: Bool?
}

struct Me: Codable {
    struct Stats: Codable { var calls: Int; var averageScore: Int?; var streakDays: Int }
    struct NextCall: Codable { var ringAt: String; var source: String }
    struct Speech: Codable { var server: Bool }
    var deviceId: String
    var settings: Settings
    var stats: Stats
    var nextCall: NextCall?
    var speech: Speech
    /// The server can place real phone calls.
    var phoneCalls: Bool?

    /// Practice and surprise calls go to the user's verified phone number.
    var ringsPhone: Bool { phoneCalls == true && settings.ringPhone == true && settings.phoneVerifiedAt != nil }
}

struct CallSummary: Codable, Identifiable, Hashable {
    var id: String
    var scenarioId: String
    var scenarioTitle: String
    var callerId: String
    var difficulty: Difficulty
    var status: String
    var source: String
    var senderName: String?
    var ringAt: String?
    var startedAt: String?
    var endedAt: String?
    var endReason: EndReason?
    var score: Int?
    var durationMs: Int?
    var via: String?
}

struct TranscriptLine: Codable, Hashable {
    var role: String
    var text: String
    var t: Int
}

struct ScoreSignal: Codable, Hashable, Identifiable {
    var id: String
    var label: String
    var points: Int
    var hit: Bool
}

struct RedFlag: Codable, Hashable {
    var turn: Int
    var label: String
}

struct Debrief: Codable, Hashable {
    var scam: String
    var biggestTell: String
    var didWell: String
    var doDifferently: String
    var earliestMoment: String
    var beforePitch: String?
    var spoken: String
}

struct CallResult: Codable, Hashable {
    var score: Int
    var signals: [ScoreSignal]
    var redFlags: [RedFlag]
    var debrief: Debrief
    var payloadWarning: Bool
}

struct CallDetail: Decodable {
    var summary: CallSummary
    var transcript: [TranscriptLine]
    var result: CallResult?

    init(from decoder: Decoder) throws {
        summary = try CallSummary(from: decoder)
        let c = try decoder.container(keyedBy: Keys.self)
        transcript = try c.decodeIfPresent([TranscriptLine].self, forKey: .transcript) ?? []
        result = try c.decodeIfPresent(CallResult.self, forKey: .result)
    }
    private enum Keys: String, CodingKey { case transcript, result }
}

/// One message from the server on the call WebSocket (ServerMessage in types.ts).
struct ServerMessage: Decodable {
    var type: String
    var turn: Int?
    var seq: Int?
    var text: String?
    var final: Bool?
    var wav: String?
    var speech: String?
    var callerId: String?
    var safeWord: String?
    var maxMs: Int?
    var reason: EndReason?
    var afterPlayback: Bool?
    var message: String?
    var voiceHint: VoiceHint?
}

extension Date {
    static func fromISO(_ s: String?) -> Date? {
        guard let s else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: s) ?? ISO8601DateFormatter().date(from: s)
    }
}

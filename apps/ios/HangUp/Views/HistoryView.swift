import SwiftUI

struct HistoryView: View {
    @EnvironmentObject var model: AppModel
    @State private var calls: [CallSummary] = []
    @State private var loaded = false

    var body: some View {
        List {
            ForEach(calls) { c in
                Button {
                    if c.score != nil { model.debrief = DebriefTarget(id: c.id) }
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.scenarioTitle).font(.body)
                            Text(subtitle(c)).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if let s = c.score {
                            Text("\(s)").font(.title3.bold().monospacedDigit())
                                .foregroundStyle(s >= 80 ? Theme.green : s >= 50 ? .orange : Theme.red)
                        } else {
                            Text(c.status.capitalized).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .foregroundStyle(.primary)
            }
        }
        .overlay {
            if loaded && calls.isEmpty {
                ContentUnavailableView("No calls yet", systemImage: "phone", description: Text("Your practice calls and scores show up here."))
            }
        }
        .navigationTitle("Past calls")
        .task {
            calls = (try? await model.api.history()) ?? []
            loaded = true
        }
    }

    private func subtitle(_ c: CallSummary) -> String {
        var parts = [c.callerId, c.difficulty.label]
        if let d = Date.fromISO(c.startedAt ?? c.ringAt) { parts.append(d.formatted(date: .abbreviated, time: .shortened)) }
        if let ms = c.durationMs { parts.append(formatDuration(Double(ms) / 1000)) }
        return parts.joined(separator: " · ")
    }
}

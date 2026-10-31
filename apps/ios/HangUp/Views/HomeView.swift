import SwiftUI

struct HomeView: View {
    @EnvironmentObject var model: AppModel
    @State private var scenarioId: String?
    @State private var difficulty: Difficulty?
    @State private var delay = 10

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let banner = model.banner {
                        Text(banner).font(.footnote).foregroundStyle(.orange)
                            .onTapGesture { model.banner = nil }
                    }
                    stats
                    practiceCard
                    nextCall
                    NavigationLink { HistoryView() } label: {
                        Card {
                            HStack {
                                Label("Past calls", systemImage: "clock.arrow.circlepath")
                                Spacer()
                                Image(systemName: "chevron.right").foregroundStyle(.secondary)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
                .padding(20)
            }
            .navigationTitle(model.me.map { "Hi, \($0.settings.displayName)" } ?? "Hang Up")
            .toolbar {
                NavigationLink { SettingsView() } label: { Image(systemName: "gearshape") }
            }
            .refreshable { await model.refresh() }
            .task { await model.didBecomeActive() }
        }
    }

    private var stats: some View {
        HStack(spacing: 12) {
            stat("\(model.me?.stats.calls ?? 0)", "calls")
            stat(model.me?.stats.averageScore.map(String.init) ?? "–", "avg score")
            stat("\(model.me?.stats.streakDays ?? 0)", "day streak")
        }
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.title2.bold())
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 16))
    }

    private var practiceCard: some View {
        Card {
            Text("Practice call").font(.headline)
            Text("Your phone will ring with a scam call. Answer it like a real one.")
                .font(.subheadline).foregroundStyle(.secondary)
            Picker("Scenario", selection: $scenarioId) {
                Text("Surprise me").tag(String?.none)
                ForEach(model.catalog?.scenarios ?? []) { s in
                    Text(s.title).tag(Optional(s.id))
                }
            }
            Picker("Difficulty", selection: $difficulty) {
                Text("Auto").tag(Difficulty?.none)
                ForEach(Difficulty.allCases) { d in Text(d.label).tag(Optional(d)) }
            }
            Picker("Ring", selection: $delay) {
                Text("Now").tag(0)
                Text("In 10 s").tag(10)
                Text("In 30 s").tag(30)
            }
            .pickerStyle(.segmented)
            if delay > 0 {
                Text("Lock your phone after tapping to get the full lock-screen call.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Button {
                Task { await model.practice(scenarioId: scenarioId, difficulty: difficulty, delay: delay) }
            } label: {
                HStack {
                    Image(systemName: "phone.fill")
                    Text(model.countdown.map { "Ringing in \($0)…" } ?? "Ring me")
                }
                .frame(maxWidth: .infinity).padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(model.countdown != nil)
        }
    }

    @ViewBuilder private var nextCall: some View {
        if let next = model.me?.nextCall, let at = Date.fromISO(next.ringAt) {
            Card {
                Label("Next surprise call", systemImage: "calendar.badge.clock").font(.headline)
                Text("Sometime around \(at.formatted(date: .abbreviated, time: .shortened)). It will ring even if the app is closed.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
        } else if model.me?.settings.scheduleEnabled == false {
            NavigationLink { SettingsView() } label: {
                Card {
                    Label("Surprise calls are off", systemImage: "calendar").font(.headline)
                    Text("Turn them on in Settings so practice calls ring when you don't expect them, like real scams do.")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)
        }
    }
}

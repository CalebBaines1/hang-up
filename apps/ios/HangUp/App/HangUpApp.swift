import SwiftUI
import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Register for VoIP pushes at every launch: iOS may launch the app in the
        // background just to deliver one, and it must ring through CallKit.
        MainActor.assumeIsolated {
            _ = AppModel.shared
            CallManager.shared.registerForVoIP()
        }
        return true
    }
}

@main
struct HangUpApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var model = AppModel.shared
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .preferredColorScheme(.dark)
                .tint(.green)
                .onChange(of: phase) { _, p in
                    if p == .active { Task { await model.didBecomeActive() } }
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        Group {
            if !model.registered {
                OnboardingView()
            } else {
                HomeView()
            }
        }
        .fullScreenCover(item: $model.activeCall) { call in
            InCallView(call: call)
        }
        .sheet(item: $model.debrief) { target in
            DebriefView(callId: target.id)
        }
    }
}

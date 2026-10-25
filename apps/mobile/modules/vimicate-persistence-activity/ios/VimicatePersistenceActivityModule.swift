import ExpoModulesCore
import UIKit

public final class VimicatePersistenceActivityModule: Module {
    private static var leases: [String: UIBackgroundTaskIdentifier] = [:]

    /// Every lease mutation runs on the module function's main queue. Never
    /// synchronously wait for the main queue from React Native: Fabric may be
    /// committing the transcript tree while JavaScript settles a write.
    private static func endLeaseOnMain(_ token: String) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard let identifier = leases.removeValue(forKey: token) else { return }
        UIApplication.shared.endBackgroundTask(identifier)
    }

    public func definition() -> ModuleDefinition {
        Name("VimicatePersistenceActivity")

        AsyncFunction("beginPersistenceWrite") { () -> String? in
            let token = UUID().uuidString
            let identifier = UIApplication.shared.beginBackgroundTask(
                withName: "Vimicate workspace persistence"
            ) {
                DispatchQueue.main.async {
                    Self.endLeaseOnMain(token)
                }
            }
            guard identifier != .invalid else { return nil }
            Self.leases[token] = identifier
            return token
        }.runOnQueue(.main)

        AsyncFunction("endPersistenceWrite") { (token: String) in
            guard !token.isEmpty else { return }
            Self.endLeaseOnMain(token)
        }.runOnQueue(.main)
    }
}

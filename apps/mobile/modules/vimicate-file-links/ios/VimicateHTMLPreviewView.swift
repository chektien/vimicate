import ExpoModulesCore
import UIKit
import WebKit

/// Isolated interactive document. No script-message handler or filesystem grant.
final class VimicateHTMLPreviewView: ExpoView, WKNavigationDelegate, WKUIDelegate {
    let onPreviewStatus = EventDispatcher()
    var dataBase64 = ""
    var filename = ""
    var mimeType = ""
    private var submitted: VimicateInlinePreviewStaging.Input?
    private var generation = UUID()
    private var webView: WKWebView?
    private var loadingInitialDocument = false
    private var backgroundObserver: NSObjectProtocol?
    private var foregroundObserver: NSObjectProtocol?

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        clipsToBounds = true
        backgroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification,
            object: nil, queue: .main) { [weak self] _ in self?.clear() }
        foregroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification,
            object: nil, queue: .main) { [weak self] _ in self?.updatePreview() }
    }

    func updatePreview() {
        let input = VimicateInlinePreviewStaging.Input(dataBase64: dataBase64, filename: filename, mimeType: mimeType)
        guard input != submitted else { return }
        clear()
        guard window != nil, UIApplication.shared.applicationState != .background else { return }
        submitted = input
        let document: String
        do { document = try VimicateHTMLPreviewPolicy.document(input) }
        catch { emit("error", error.localizedDescription); return }
        let id = generation
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "VimicateIsolatedHTML-v1",
            encodedContentRuleList: VimicateHTMLPreviewPolicy.networkRules) { [weak self] rules, error in
            DispatchQueue.main.async {
                guard let self, self.generation == id else { return }
                guard let rules, error == nil else {
                    self.emit("error", "The isolated HTML preview could not be prepared.")
                    return
                }
                let configuration = WKWebViewConfiguration()
                configuration.websiteDataStore = .nonPersistent()
                configuration.userContentController.add(rules)
                configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
                configuration.ignoresViewportScaleLimits = true
                configuration.dataDetectorTypes = []
                let web = WKWebView(frame: self.bounds, configuration: configuration)
                web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                web.navigationDelegate = self
                web.uiDelegate = self
                web.allowsLinkPreview = false
                web.allowsBackForwardNavigationGestures = false
                web.scrollView.contentInsetAdjustmentBehavior = .never
                web.accessibilityLabel = "HTML file preview"
                self.webView = web
                self.addSubview(web)
                self.loadingInitialDocument = true
                web.loadHTMLString(document, baseURL: nil)
            }
        }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        // React Native detaches display:none views when switching to Source.
        // Retain this one bounded document until content replacement/background
        // or deinit, so hiding the renderer cannot reset DOM state or scrolling.
        if window != nil { updatePreview() }
    }

    private func clear() {
        generation = UUID()
        submitted = nil
        webView?.stopLoading()
        webView?.navigationDelegate = nil
        webView?.uiDelegate = nil
        webView?.removeFromSuperview()
        webView = nil
        loadingInitialDocument = false
    }

    private func emit(_ status: String, _ message: String? = nil) {
        var event: [String: Any] = ["status": status]
        if let message { event["message"] = message }
        onPreviewStatus(event)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard webView === self.webView else { decisionHandler(.cancel); return }
        let allowed = navigationAction.targetFrame?.isMainFrame == true &&
            VimicateHTMLPreviewPolicy.allowsNavigation(to: navigationAction.request.url,
                current: webView.url, initial: loadingInitialDocument)
        decisionHandler(allowed ? .allow : .cancel)
        if !allowed { emit("ready", "Links and external resources stay blocked in this standalone preview.") }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === self.webView else { return }
        loadingInitialDocument = false
        emit("ready")
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard webView === self.webView, (error as NSError).code != NSURLErrorCancelled else { return }
        emit("error", "This HTML file could not be displayed.")
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard webView === self.webView, (error as NSError).code != NSURLErrorCancelled else { return }
        emit("error", "This HTML file could not finish loading. Retry preview to reload it.")
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard webView === self.webView else { return }
        clear()
        emit("error", "The HTML preview stopped. Retry preview to reload it.")
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        emit("ready", "Open-in-new-window links are unavailable in this preview.")
        return nil
    }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) { decisionHandler(.deny) }

    deinit {
        if let backgroundObserver { NotificationCenter.default.removeObserver(backgroundObserver) }
        if let foregroundObserver { NotificationCenter.default.removeObserver(foregroundObserver) }
        webView?.stopLoading()
        webView?.navigationDelegate = nil
        webView?.uiDelegate = nil
    }
}

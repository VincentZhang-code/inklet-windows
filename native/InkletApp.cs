using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: System.Reflection.AssemblyTitle("Inklet 墨点")]
[assembly: System.Reflection.AssemblyProduct("Inklet")]
[assembly: System.Reflection.AssemblyCompany("泰安市岱岳区清云智数企业管理咨询工作室")]
[assembly: System.Reflection.AssemblyCopyright("版权所有 © 2026 泰安市岱岳区清云智数企业管理咨询工作室。保留所有权利。")]
[assembly: System.Reflection.AssemblyVersion("0.11.2.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.11.2.0")]

namespace Inklet {
    public sealed class InkletApplication : ApplicationContext {
        public readonly FileStore Store;
        public readonly WorkspaceStore Workspace;
        public readonly ReadingHistory Reading;
        public readonly SemaphoreSlim Messages = new SemaphoreSlim(1, 1);
        public readonly string Profile, DebugPort;
        private readonly List<InkletWindow> windows = new List<InkletWindow>();
        private readonly string settingsPath;
        private Dictionary<string, object> settings = new Dictionary<string, object>();
        private InkletWindow activeWindow;
        private Task<CoreWebView2Environment> environment;
        private readonly Dictionary<string, WindowTransfer> transfers = new Dictionary<string, WindowTransfer>();
        private sealed class WindowTransfer {
            public string Token, DocumentId;
            public InkletWindow Source, Target;
            public bool Ready;
            public System.Windows.Forms.Timer Timer;
        }
        public InkletApplication(string profile, string file, string port) {
            Profile = profile; DebugPort = port;
            Store = new FileStore(profile);
            Reading = new ReadingHistory(profile);
            Workspace = new WorkspaceStore(Store);
            Workspace.ImportLegacyRecovery();
            settingsPath = Path.Combine(profile, "settings.json");
            if (File.Exists(settingsPath)) {
                try { settings = Store.Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(settingsPath)) ?? settings; }
                catch (IOException) { } catch (ArgumentException) { } catch (InvalidOperationException) { }
            }
            CreateWindow(file, true);
        }
        public Task<CoreWebView2Environment> Environment() {
            if (environment == null) {
                var options = new CoreWebView2EnvironmentOptions();
                if (!String.IsNullOrEmpty(DebugPort)) options.AdditionalBrowserArguments = "--remote-debugging-port=" + DebugPort + " --remote-debugging-address=127.0.0.1";
                environment = CoreWebView2Environment.CreateAsync(null, Path.Combine(Profile, "webview"), options);
            }
            return environment;
        }
        public object Settings() { return new Dictionary<string, object>(settings); }
        public bool SeparateWindows {
            get { object value; return settings.TryGetValue("separateWindows", out value) && value is bool && (bool)value; }
        }
        public void SaveSettings(Dictionary<string, object> values, InkletWindow source) {
            var next = new Dictionary<string, object>(values);
            next.Remove("documentId");
            FileStore.AtomicWrite(settingsPath, Encoding.UTF8.GetBytes(Store.Json.Serialize(next)));
            settings = next;
            foreach (var window in windows.Where(window => window != source && window.FrontendReady)) window.SendEvent("settingsChanged", Settings());
        }
        public void Activated(InkletWindow window) { if (!window.IsDisposed) activeWindow = window; }
        public void ForgetWindow(InkletWindow window) {
            windows.Remove(window);
            if (activeWindow == window) activeWindow = windows.LastOrDefault();
            if (windows.Count == 0) ExitThread();
        }
        public InkletWindow CreateWindow(string file, bool claimRecovery = false, string transferToken = null, Dictionary<string, object> snapshot = null) {
            string id = Guid.NewGuid().ToString("N");
            var scoped = Workspace.ForWindow(id);
            if (claimRecovery) scoped.ClaimRecovered();
            var window = new InkletWindow(this, scoped, file, id, transferToken, snapshot);
            windows.Add(window);
            window.FormClosed += (sender, args) => {
                CancelTransfers(window, "窗口已关闭，文档移交已取消。");
                ForgetWindow(window);
            };
            if (activeWindow != null) {
                var area = Screen.FromControl(activeWindow).WorkingArea;
                window.StartPosition = FormStartPosition.Manual;
                window.Location = new Point(Math.Max(area.Left, Math.Min(activeWindow.Left + 36, area.Right - window.Width)), Math.Max(area.Top, Math.Min(activeWindow.Top + 36, area.Bottom - window.Height)));
            }
            if (transferToken == null) window.Show();
            return window;
        }
        public object PrepareTransfer(InkletWindow source, string id, string token, Dictionary<string, object> snapshot, Point? dropPoint) {
            Guid parsed;
            if (!Guid.TryParseExact(token, "N", out parsed) || transfers.ContainsKey(token)) throw new IOException("窗口移交请求无效。");
            source.Documents.EnsureWritable(id);
            var target = CreateWindow(null, false, token, snapshot);
            var transfer = new WindowTransfer { Token = token, DocumentId = id, Source = source, Target = target, Timer = new System.Windows.Forms.Timer { Interval = 45000 } };
            try {
                source.Documents.StageMove(id, target.Documents);
                transfers.Add(token, transfer);
                transfer.Timer.Tick += (sender, args) => CancelTransfer(transfer, "新窗口未能及时就绪，原窗口中的文档已保留。");
                transfer.Timer.Start();
                if (dropPoint.HasValue) {
                    var point = dropPoint.Value;
                    var area = Screen.FromPoint(point).WorkingArea;
                    target.StartPosition = FormStartPosition.Manual;
                    target.Location = new Point(Math.Max(area.Left, Math.Min(point.X - target.Width / 4, area.Right - target.Width)), Math.Max(area.Top, Math.Min(point.Y - 36, area.Bottom - target.Height)));
                }
                target.Show();
                return new { token = token, documentId = id, pending = true, targetWindowId = target.WindowId };
            } catch {
                if (transfers.ContainsKey(token)) CancelTransfer(transfer, "新窗口创建失败，原文档已保留。");
                else { target.AbortIncoming(); transfer.Timer.Dispose(); }
                throw;
            }
        }
        public void TransferReady(InkletWindow target, string token) {
            WindowTransfer transfer;
            if (!transfers.TryGetValue(token, out transfer) || transfer.Target != target) throw new IOException("窗口移交请求已取消。");
            transfer.Ready = true;
            transfer.Source.SendEvent("detachReady", new { token = token, documentId = transfer.DocumentId });
        }
        public object CommitTransfer(InkletWindow source, string token) {
            WindowTransfer transfer;
            if (!transfers.TryGetValue(token, out transfer) || transfer.Source != source || !transfer.Ready || !transfer.Target.FrontendReady) throw new IOException("新窗口尚未就绪，原文档未移除。");
            source.Documents.CommitMove(transfer.DocumentId, transfer.Target.Documents);
            transfers.Remove(token); transfer.Timer.Dispose();
            transfer.Target.CompleteIncoming();
            source.RefreshWatchers(); transfer.Target.RefreshWatchers();
            return new { moved = true, documentId = transfer.DocumentId, targetWindowId = transfer.Target.WindowId };
        }
        private void CancelTransfer(WindowTransfer transfer, string message) {
            if (!transfers.Remove(transfer.Token)) return;
            transfer.Timer.Dispose();
            transfer.Source.Documents.CancelMove(transfer.DocumentId, transfer.Target.Documents);
            transfer.Target.AbortIncoming();
            transfer.Source.SendEvent("detachCancelled", new { token = transfer.Token, message = message });
        }
        public bool CancelTransfers(InkletWindow window, string message) {
            var pending = transfers.Values.Where(item => item.Source == window || item.Target == window).ToArray();
            foreach (var transfer in pending) CancelTransfer(transfer, message);
            return pending.Length > 0;
        }
        public object OpenPaths(InkletWindow source, IEnumerable<string> paths) {
            var local = new List<object>();
            var failures = new List<string>();
            foreach (string path in paths) {
                try {
                    var existing = Workspace.FindPath(path);
                    if (existing != null) {
                        var target = windows.FirstOrDefault(window => window.WindowId == Workspace.OwnerOf(existing.Id));
                        if (target == source) local.Add(existing.Info());
                        else if (target != null) target.SelectDocument(existing.Id);
                        else throw new IOException("此文件留有待恢复会话，请重新启动后恢复，未覆盖原草稿。");
                    } else if (SeparateWindows) CreateWindow(path);
                    else local.Add(source.Documents.Add(path).Info());
                } catch (IOException error) { failures.Add(Path.GetFileName(path) + ": " + error.Message); }
                catch (UnauthorizedAccessException) { failures.Add(Path.GetFileName(path) + ": 没有读取权限。"); }
            }
            source.RefreshWatchers();
            return new { documents = local.ToArray(), warnings = failures.ToArray() };
        }
        public void OpenExternal(string path) {
            var target = activeWindow != null && !activeWindow.IsDisposed ? activeWindow : windows.LastOrDefault();
            if (target == null) { CreateWindow(String.IsNullOrWhiteSpace(path) ? null : path); return; }
            target.QueueOpen(path);
        }
    }

    public sealed class InkletWindow : Form {
        private readonly InkletApplication application;
        public readonly string WindowId;
        public WorkspaceStore Documents { get { return workspace; } }
        public bool FrontendReady { get { return frontendReady && !pageFailed && !IsDisposed; } }
        private string incomingToken;
        private Dictionary<string, object> incomingSnapshot;
        private bool draggingDocument;
        private readonly WebView2 browser = new WebView2();
        private ResourcePack resources;
        private readonly FileStore store;
        private readonly WorkspaceStore workspace;
        private string activeDocumentId;
        private bool workspaceReady;
        private bool closeRequested;
        private readonly RuntimeDiagnostics diagnostics;
        private readonly string startupFile;
        private bool dirty;
        private bool allowClose;
        private bool working;
        private readonly List<FileSystemWatcher> watchers = new List<FileSystemWatcher>();
        private readonly HashSet<string> externalChanges = new HashSet<string>();
        private readonly System.Windows.Forms.Timer externalTimer = new System.Windows.Forms.Timer { Interval = 450 };
        private int watchGeneration;
        private readonly SemaphoreSlim messages;
        private readonly System.Web.Script.Serialization.JavaScriptSerializer messageJson = new System.Web.Script.Serialization.JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024, RecursionLimit = 128 };
        private readonly string windowIdentity;
        private readonly Dictionary<string, string> openRequests = new Dictionary<string, string>();
        private IntPtr registeredWindow;
        private bool frontendReady;
        private bool initialized;
        private bool pageFailed;
        private string webViewVersion;
        private int documentLength;
        private bool searchActive;
        private int searchQueryLength;
        private int searchMatchCount;
        [DllImport("user32.dll")] private static extern uint GetDpiForSystem();

        public InkletWindow(InkletApplication context, WorkspaceStore documents, string file, string windowId, string transferToken = null, Dictionary<string, object> transferSnapshot = null) {
            application = context;
            WindowId = windowId;
            incomingToken = transferToken;
            incomingSnapshot = transferSnapshot;
            store = context.Store;
            workspace = documents;
            messages = context.Messages;
            diagnostics = new RuntimeDiagnostics(store.DataDirectory);
            startupFile = file;
            windowIdentity = ShellIntegration.Identity(context.Profile);
            Text = "Inklet 墨点";
            double scale = 1;
            try { scale = GetDpiForSystem() / 96.0; } catch { }
            var available = Screen.PrimaryScreen.WorkingArea;
            ClientSize = new Size(Math.Min((int)(1380 * scale), available.Width - 100), Math.Min((int)(880 * scale), available.Height - 120));
            MinimumSize = new Size(Math.Min((int)(820 * scale), available.Width - 100), Math.Min((int)(570 * scale), available.Height - 120));
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(243, 247, 242);
            AutoScaleMode = AutoScaleMode.Dpi;
            string iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Inklet.ico");
            if (File.Exists(iconPath)) Icon = new Icon(iconPath);
            browser.Dock = DockStyle.Fill;
            browser.DefaultBackgroundColor = BackColor;
            Controls.Add(browser);
            Shown += async (sender, args) => {
                registeredWindow = Handle;
                ShellIntegration.SetProp(registeredWindow, windowIdentity, new IntPtr(1));
                ShellIntegration.SetProp(registeredWindow, "InkletWindow-" + WindowId, new IntPtr(1));
                await Initialize();
            };
            FormClosing += OnClosing;
            externalTimer.Tick += (sender, args) => {
                externalTimer.Stop();
                if (working) { externalTimer.Start(); return; }
                if (frontendReady && !pageFailed) {
                    foreach (string id in externalChanges.ToArray()) {
                        var document = workspace.Documents.FirstOrDefault(item => item.Id == id);
                        if (document != null) Notify("externalChange", new { documentId = id, path = document.Path });
                    }
                }
                externalChanges.Clear();
            };
            Activated += (sender, args) => {
                application.Activated(this);
                if (frontendReady && activeDocumentId != null) QueueExternalChange(watchGeneration, activeDocumentId);
            };
        }

        protected override void WndProc(ref Message message) {
            if (message.Msg == ShellIntegration.CopyDataMessage && message.LParam != IntPtr.Zero) {
                var data = (ShellIntegration.CopyData)Marshal.PtrToStructure(message.LParam, typeof(ShellIntegration.CopyData));
                if (data.Tag == ShellIntegration.MessageTag && data.Data != IntPtr.Zero && data.Length >= 2 && data.Length <= 64002 && data.Length % 2 == 0) {
                    string path = Marshal.PtrToStringUni(data.Data, data.Length / 2 - 1);
                    BeginInvoke(new Action(() => application.OpenExternal(path)));
                    message.Result = new IntPtr(1);
                    return;
                }
            }
            base.WndProc(ref message);
        }

        public void QueueOpen(string path) {
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Show(); Activate();
            ShellIntegration.SetForegroundWindow(Handle);
            if (String.IsNullOrWhiteSpace(path)) return;
            if (openRequests.Count >= 32) return;
            string id = Guid.NewGuid().ToString("N");
            openRequests[id] = path;
            if (frontendReady) Notify("openRequest", new { id = id });
        }
        public void SendEvent(string name, object data = null) { Notify(name, data); }
        public void SelectDocument(string id) {
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Show(); Activate(); ShellIntegration.SetForegroundWindow(Handle);
            if (FrontendReady) Notify("selectDocument", new { documentId = id });
        }
        public void RefreshWatchers() { Watch(); }
        public void CompleteIncoming() {
            incomingToken = null; incomingSnapshot = null;
            Notify("detachCommitted");
        }
        public void AbortIncoming() {
            incomingToken = null; incomingSnapshot = null; allowClose = true;
            if (IsHandleCreated && !IsDisposed) BeginInvoke(new Action(Close));
            else { if (!IsDisposed) Dispose(); application.ForgetWindow(this); }
        }
        private object DragDocument(string id) {
            workspace.EnsureWritable(id);
            if ((Control.MouseButtons & MouseButtons.Left) == 0) return new { outside = false };
            bool outside = false;
            Point point = Cursor.Position;
            QueryContinueDragEventHandler continuing = (sender, args) => {
                if (args.EscapePressed) { outside = false; args.Action = DragAction.Cancel; }
                else if ((args.KeyState & 1) == 0) {
                    point = Cursor.Position;
                    outside = !Bounds.Contains(point);
                    args.Action = DragAction.Drop;
                }
            };
            draggingDocument = true;
            QueryContinueDrag += continuing;
            try { DoDragDrop(new DataObject("Inklet.Document", id), DragDropEffects.Move); }
            finally { QueryContinueDrag -= continuing; draggingDocument = false; }
            return new { outside = outside, x = point.X, y = point.Y };
        }

        private async Task Initialize() {
            try {
                var environment = await application.Environment();
                if (IsDisposed || Disposing || allowClose) return;
                await browser.EnsureCoreWebView2Async(environment);
                if (IsDisposed || Disposing || allowClose) return;
                var core = browser.CoreWebView2;
                webViewVersion = environment.BrowserVersionString;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.AreDevToolsEnabled = !String.IsNullOrEmpty(application.DebugPort);
                core.Settings.AreBrowserAcceleratorKeysEnabled = false;
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.IsZoomControlEnabled = false;
                core.Settings.IsPinchZoomEnabled = false;
                core.Settings.AreDefaultScriptDialogsEnabled = false;
                resources = new ResourcePack(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Inklet.resources"));
                core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
                core.WebResourceRequested += ResourceRequested;
                core.WebMessageReceived += MessageReceived;
                core.NavigationStarting += (sender, args) => {
                    Uri uri;
                    if (pageFailed || !Uri.TryCreate(args.Uri, UriKind.Absolute, out uri) || uri.Host != "inklet.local" || uri.Scheme != "https") args.Cancel = true;
                };
                core.NewWindowRequested += (sender, args) => { args.Handled = true; };
                core.PermissionRequested += (sender, args) => { args.State = CoreWebView2PermissionState.Deny; };
                core.DownloadStarting += (sender, args) => { args.Cancel = true; };
                core.ProcessFailed += ProcessFailed;
                initialized = true;
                core.Navigate("https://inklet.local/index.html?window=" + WindowId);
            } catch (Exception error) {
                if (IsDisposed || Disposing || allowClose) return;
                if (incomingToken != null) { application.CancelTransfers(this, "新窗口启动失败：" + error.Message); return; }
                MessageBox.Show(this, "无法启动 Inklet。请确认便携包文件完整，并已安装 Microsoft Edge WebView2 Runtime。\n\n" + error.Message, "Inklet", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void ResourceRequested(object sender, CoreWebView2WebResourceRequestedEventArgs args) {
            Uri uri;
            if (!Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out uri)) return;
            if (uri.Scheme == "blob" || uri.Scheme == "data") return;
            if (uri.Host == "inklet.local" && uri.Scheme == "https") {
                try {
                    string contentType;
                    string name = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/'));
                    Stream content = resources.Open(name, out contentType);
                    if (content != null) {
                        string caching = name.StartsWith("assets/", StringComparison.Ordinal) ? "public, max-age=31536000, immutable" : "no-store";
                        args.Response = browser.CoreWebView2.Environment.CreateWebResourceResponse(content, 200, "OK", "Content-Type: " + contentType + "\r\nCache-Control: " + caching + "\r\nX-Content-Type-Options: nosniff");
                        return;
                    }
                } catch (IOException) { }
                args.Response = browser.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(new byte[0]), 404, "Not found", "Content-Type: text/plain");
                return;
            }
            if (uri.Host == "inklet-files.local" && uri.Scheme == "https") {
                try {
                    string relative = uri.AbsolutePath.TrimStart('/');
                    string documentId;
                    if (uri.AbsolutePath == "/image") {
                        var query = System.Web.HttpUtility.ParseQueryString(uri.Query, Encoding.UTF8);
                        documentId = query["document"];
                        relative = query["path"];
                        if (String.IsNullOrEmpty(documentId) || String.IsNullOrEmpty(relative)) throw new IOException("图片请求缺少文档或路径。");
                    } else {
                        int separator = relative.IndexOf('/');
                        if (separator <= 0) throw new IOException("文档图片缺少身份。");
                        documentId = relative.Substring(0, separator);
                        relative = relative.Substring(separator + 1);
                    }
                    var owner = workspace.Store(documentId);
                    string path = owner.ResolveImagePath(relative);
                    string extension = Path.GetExtension(path).ToLowerInvariant();
                    var types = new Dictionary<string, string> { { ".png", "image/png" }, { ".jpg", "image/jpeg" }, { ".jpeg", "image/jpeg" }, { ".webp", "image/webp" }, { ".gif", "image/gif" }, { ".bmp", "image/bmp" }, { ".svg", "image/svg+xml" } };
                    if (!types.ContainsKey(extension) || !File.Exists(path) || new FileInfo(path).Length > 32 * 1024 * 1024) throw new IOException();
                    var stream = new MemoryStream(File.ReadAllBytes(path), false);
                    args.Response = browser.CoreWebView2.Environment.CreateWebResourceResponse(stream, 200, "OK", "Content-Type: " + types[extension] + "\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'");
                    return;
                } catch { }
            }
            args.Response = browser.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(new byte[0]), 403, "Blocked", "Content-Type: text/plain");
        }

        private static string StringValue(IDictionary<string, object> values, string key, string fallback = "") {
            object value;
            return values.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : fallback;
        }
        private static bool BooleanValue(IDictionary<string, object> values, string key) {
            object value;
            return values.TryGetValue(key, out value) && value is bool && (bool)value;
        }
        private static int CountValue(IDictionary<string, object> values, string key) {
            int value;
            return Int32.TryParse(StringValue(values, key), out value) ? Math.Max(0, Math.Min(24 * 1024 * 1024, value)) : 0;
        }
        private bool RecordDiagnostic(string kind, string reason, int? exitCode) {
            try {
                diagnostics.Append(new RuntimeDiagnostic {
                    AppVersion = Application.ProductVersion, WebViewVersion = webViewVersion,
                    Kind = kind, Reason = reason, ExitCode = exitCode, Dirty = dirty,
                    DocumentLength = documentLength, SearchActive = searchActive,
                    QueryLength = searchQueryLength, MatchCount = searchMatchCount
                });
                return true;
            } catch (IOException) { return false; } catch (UnauthorizedAccessException) { return false; }
        }
        private void ProcessFailed(object sender, CoreWebView2ProcessFailedEventArgs args) {
            bool logged = RecordDiagnostic(args.ProcessFailedKind.ToString(), args.Reason.ToString(), args.ExitCode);
            if (args.ProcessFailedKind != CoreWebView2ProcessFailedKind.RenderProcessExited && args.ProcessFailedKind != CoreWebView2ProcessFailedKind.BrowserProcessExited) return;
            if (pageFailed) return;
            pageFailed = true;
            frontendReady = false;
            if (application.CancelTransfers(this, "新窗口渲染失败，原文档已保留。") && incomingToken == null && allowClose) return;
            MessageBox.Show(this, "编辑页面进程已退出。请关闭并重新打开 Inklet，尝试恢复最后已落盘的草稿。最近尚未落盘的输入可能无法恢复。\n\n" +
                (logged ? "故障日志仅保存在本机，不含正文或查找词：\n" + diagnostics.LogPath : "本次故障日志未能写入。"), "Inklet", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        private void Reply(object message) {
            if (!initialized || IsDisposed || pageFailed) return;
            try { browser.CoreWebView2.PostWebMessageAsJson(messageJson.Serialize(message)); }
            catch (InvalidOperationException) { } catch (COMException) { }
        }
        private void Notify(string name, object data = null) {
            Reply(new { @event = name, data = data });
        }
        private async void MessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs eventArgs) {
            Uri source;
            if (!Uri.TryCreate(eventArgs.Source, UriKind.Absolute, out source) || source.Host != "inklet.local" || source.Scheme != "https") return;
            object id = null;
            await messages.WaitAsync();
            try {
                var request = messageJson.Deserialize<Dictionary<string, object>>(eventArgs.WebMessageAsJson);
                id = request["id"];
                string command = Convert.ToString(request["command"]);
                var args = request.ContainsKey("args") ? (Dictionary<string, object>)request["args"] : new Dictionary<string, object>();
                object result = await Execute(command, args);
                Reply(new { id = id, result = result });
            } catch (Exception error) {
                Reply(new { id = id, error = error.Message });
            } finally { messages.Release(); }
        }

        private async Task<object> Execute(string command, Dictionary<string, object> args) {
            string documentId = StringValue(args, "documentId");
            if (command == "dragDocument") return DragDocument(documentId);
            if (command == "detachDocument") {
                workspace.EnsureWritable(documentId);
                var snapshot = (Dictionary<string, object>)args["snapshot"];
                await Task.Run(() => workspace.SaveSession(documentId, snapshot));
                Point? dropPoint = null;
                object pointValue;
                if (args.TryGetValue("dropPoint", out pointValue) && pointValue is Dictionary<string, object>) {
                    var point = (Dictionary<string, object>)pointValue;
                    int horizontal, vertical;
                    if (Int32.TryParse(StringValue(point, "x"), out horizontal) && Int32.TryParse(StringValue(point, "y"), out vertical)) dropPoint = new Point(horizontal, vertical);
                }
                return application.PrepareTransfer(this, documentId, StringValue(args, "token"), snapshot, dropPoint);
            }
            if (command == "commitDetach") return application.CommitTransfer(this, StringValue(args, "token"));
            if (command == "cancelDetach") { application.CancelTransfers(this, "窗口移交已取消，原文档已保留。"); return true; }
            if (command == "windowBounds") {
                Point origin = browser.PointToScreen(Point.Empty);
                return new { x = origin.X, y = origin.Y, width = browser.ClientSize.Width, height = browser.ClientSize.Height, left = Bounds.Left, top = Bounds.Top, right = Bounds.Right, bottom = Bounds.Bottom };
            }
            if (command == "workspaceList") return workspace.List();
            if (command == "readReadingPosition") return await Task.Run(() => application.Reading.Read(workspace.Get(documentId).Path));
            if (command == "saveReadingPosition") {
                object value;
                if (!args.TryGetValue("position", out value)) throw new ArgumentException("Reading position is required.");
                var point = store.Json.Deserialize<ReadingPosition>(store.Json.Serialize(value));
                point.Path = workspace.Get(documentId).Path;
                await Task.Run(() => application.Reading.Record(point));
                return true;
            }
            if (command == "loadDocument") {
                object loaded = await Task.Run(() => workspace.Load(documentId));
                Watch();
                return loaded;
            }
            if (command == "activateDocument") {
                workspace.Get(documentId);
                activeDocumentId = documentId;
                return true;
            }
            if (command == "storeSession") return await Task.Run(() => workspace.SaveSession(documentId, (Dictionary<string, object>)args["snapshot"]));
            if (command == "readSession") return await Task.Run(() => workspace.ReadSession(documentId));
            if (command == "releaseDocument") { workspace.Store(documentId).ReleaseRecoveryCache(); return true; }
            if (command == "closeDocuments") {
                string[] ids = ((IEnumerable)args["ids"]).Cast<object>().Select(Convert.ToString).ToArray();
                workspace.Close(ids, BooleanValue(args, "discard"));
                if (ids.Contains(activeDocumentId)) activeDocumentId = null;
                Watch();
                return true;
            }
            if (command == "finishClose") {
                if (workspace.Documents.Any(item => item.Dirty)) throw new IOException("仍有未保存文档，未退出。");
                workspace.Close(workspace.Documents.Select(item => item.Id).ToArray(), false);
                allowClose = true;
                BeginInvoke(new Action(Close));
                return true;
            }
            if (command == "cancelClose") { closeRequested = false; return true; }
            if (command == "ready") {
                frontendReady = true;
                if (incomingToken != null) application.TransferReady(this, incomingToken);
                foreach (string id in openRequests.Keys) Notify("openRequest", new { id = id });
                return true;
            }
            if (command == "dismissOpen") { openRequests.Remove(StringValue(args, "id")); return true; }
            if (command == "history") return store.History.Read();
            if (command == "openHistory") {
                try {
                    string path = store.History.Resolve(StringValue(args, "id"));
                    return application.OpenPaths(this, new[] { path });
                } catch (FileNotFoundException error) { return new { missing = true, path = error.FileName }; }
            }
            if (command == "openRequested") {
                string id = StringValue(args, "id");
                string path;
                if (!openRequests.TryGetValue(id, out path)) throw new IOException("打开请求已失效，请重新选择文件。");
                openRequests.Remove(id);
                return application.OpenPaths(this, new[] { path });
            }
            if (command == "registerDefault") {
                ShellIntegration.Register(Registry.CurrentUser, Application.ExecutablePath);
                ShellIntegration.NotifyAssociationChange();
                Process.Start(new ProcessStartInfo(ShellIntegration.DefaultAppsUri) { UseShellExecute = true });
                return true;
            }
            if (command == "hello") {
                object settings = application.Settings();
                object document = null;
                object startupWarning = null;
                if (!workspaceReady) {
                    workspaceReady = true;
                    if (incomingSnapshot != null) activeDocumentId = Convert.ToString(incomingSnapshot["documentId"]);
                    else if (!String.IsNullOrEmpty(startupFile)) {
                        try { activeDocumentId = workspace.Add(startupFile).Id; }
                        catch (IOException error) { startupWarning = new { message = error.Message, path = startupFile }; }
                        catch (UnauthorizedAccessException) { startupWarning = new { message = "没有读取此文件的权限。", path = startupFile }; }
                    }
                    if (activeDocumentId == null && workspace.Documents.Length > 0) activeDocumentId = workspace.Documents[0].Id;
                    bool placeholder = activeDocumentId == null;
                    if (placeholder) activeDocumentId = workspace.Add(null).Id;
                    var opened = incomingSnapshot != null ? new Dictionary<string, object>((Dictionary<string, object>)incomingSnapshot["info"]) :
                        store.Json.Deserialize<Dictionary<string, object>>(store.Json.Serialize(await Task.Run(() => workspace.Load(activeDocumentId))));
                    opened["id"] = activeDocumentId;
                    opened["placeholder"] = placeholder;
                    document = opened;
                    Watch();
                }
                return new { settings = settings, document = document, documents = workspace.List(), session = incomingSnapshot, transfer = incomingToken, workspace = true, multipleWindows = true, windowId = WindowId, recovery = (object)null, startupWarning = startupWarning };
            }
            if (command == "settings") {
                application.SaveSettings(args, this);
                return true;
            }
            if (command == "state") {
                if (incomingToken != null) return true;
                bool currentDirty = BooleanValue(args, "dirty");
                if (!String.IsNullOrEmpty(documentId) && workspace.Documents.Any(item => item.Id == documentId)) workspace.MarkDirty(documentId, currentDirty);
                dirty = workspace.Documents.Any(item => item.Dirty);
                documentLength = CountValue(args, "characters");
                if (documentId == activeDocumentId) Text = (currentDirty ? "* " : "") + StringValue(args, "name", "未命名.md") + " - Inklet 墨点";
                return true;
            }
            if (command == "searchState") {
                searchActive = BooleanValue(args, "active");
                searchQueryLength = CountValue(args, "queryLength");
                searchMatchCount = CountValue(args, "matches");
                if (BooleanValue(args, "failed")) RecordDiagnostic("SearchWorkerFailed", "WorkerError", null);
                return true;
            }
            if (command == "draft") {
                workspace.EnsureWritable(documentId);
                await Task.Run(() => workspace.Store(documentId).SaveRecovery(args));
                workspace.MarkDirty(documentId, true);
                return new { persisted = true, documentId = documentId, revision = args["revision"] };
            }
            if (command == "draftDelta") {
                workspace.EnsureWritable(documentId);
                object result = await Task.Run(() => workspace.Store(documentId).AppendRecovery(args));
                workspace.MarkDirty(documentId, true);
                return result;
            }
            if (command == "new") {
                var item = workspace.Add(null);
                var result = store.Json.Deserialize<Dictionary<string, object>>(store.Json.Serialize(workspace.Load(item.Id)));
                result["placeholder"] = BooleanValue(args, "placeholder");
                return result;
            }
            if (command == "recover") {
                workspace.EnsureWritable(documentId);
                workspace.Store(documentId).Recover(args);
                args["path"] = workspace.Store(documentId).CurrentPath;
                Watch();
                return args;
            }
            if (command == "open") {
                using (var dialog = new OpenFileDialog { Title = "打开 Markdown", Filter = "Markdown 文档|*.md;*.markdown;*.txt|所有文件|*.*", CheckFileExists = true, Multiselect = true }) {
                    if (dialog.ShowDialog(this) != DialogResult.OK) return null;
                    return application.OpenPaths(this, dialog.FileNames);
                }
            }
            if (command == "save") {
                workspace.EnsureWritable(documentId);
                working = true;
                try {
                    var owner = workspace.Store(documentId);
                    string path = owner.CurrentPath;
                    if (path == null || BooleanValue(args, "saveAs")) {
                        using (var dialog = new SaveFileDialog { Title = "保存 Markdown", Filter = "Markdown 文档|*.md", FileName = StringValue(args, "name", "未命名.md"), DefaultExt = "md", AddExtension = true, OverwritePrompt = true }) {
                            if (dialog.ShowDialog(this) != DialogResult.OK) return null;
                            path = dialog.FileName;
                        }
                    }
                    var annotations = args.ContainsKey("annotations") ? (Dictionary<string, object>)args["annotations"] : new Dictionary<string, object>();
                    var resources = args.ContainsKey("resources") ? ((IEnumerable)args["resources"]).Cast<object>().Select(Convert.ToString).ToArray() : new string[0];
                    object saved = await Task.Run(() => workspace.Save(documentId, path, StringValue(args, "text"), annotations, resources));
                    Watch();
                    return saved;
                } finally { working = false; }
            }
            if (command == "importImage") { workspace.EnsureWritable(documentId); return workspace.Store(documentId).ImportImage(StringValue(args, "data"), StringValue(args, "mime")); }
            if (command == "readAsset") return workspace.Store(documentId).ReadImage(StringValue(args, "path"));
            if (command == "readExternal") return await Task.Run(() => workspace.Store(documentId).ReadExternal(StringValue(args, "path")));
            if (command == "acceptExternal") {
                workspace.EnsureWritable(documentId);
                bool accepted = workspace.Store(documentId).AcceptExternal(StringValue(args, "path"), StringValue(args, "stamp"));
                if (accepted) workspace.MarkDirty(documentId, false);
                return accepted;
            }
            if (command == "export") return await ExportService.Export(this, browser, workspace.Store(documentId), args);
            if (command == "external") {
                Uri uri;
                if (!Uri.TryCreate(StringValue(args, "url"), UriKind.Absolute, out uri) || (uri.Scheme != "https" && uri.Scheme != "http")) throw new IOException("不支持的链接。");
                Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
                return true;
            }
            throw new IOException("未知的本地操作。");
        }

        private void QueueExternalChange(int generation, string documentId) {
            if (IsDisposed || !IsHandleCreated) return;
            try {
                BeginInvoke(new Action(() => {
                    if (IsDisposed || generation != watchGeneration) return;
                    externalChanges.Add(documentId);
                    externalTimer.Stop(); externalTimer.Start();
                }));
            } catch (InvalidOperationException) { }
        }

        private void Watch() {
            int generation = ++watchGeneration;
            externalTimer.Stop();
            foreach (var watcher in watchers) watcher.Dispose();
            watchers.Clear();
            foreach (var group in workspace.Documents.Where(item => item.Path != null).GroupBy(item => Path.GetDirectoryName(item.Path), StringComparer.OrdinalIgnoreCase)) {
                if (!Directory.Exists(group.Key)) continue;
                var entries = group.ToArray();
                var watcher = new FileSystemWatcher(group.Key) { NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.Size | NotifyFilters.FileName };
                FileSystemEventHandler changed = (sender, args) => {
                    foreach (var item in entries.Where(item => String.Equals(item.Path, args.FullPath, StringComparison.OrdinalIgnoreCase))) QueueExternalChange(generation, item.Id);
                };
                watcher.Changed += changed; watcher.Deleted += changed; watcher.Created += changed;
                watcher.Renamed += (sender, args) => {
                    foreach (var item in entries.Where(item => String.Equals(item.Path, args.FullPath, StringComparison.OrdinalIgnoreCase) || String.Equals(item.Path, args.OldFullPath, StringComparison.OrdinalIgnoreCase))) QueueExternalChange(generation, item.Id);
                };
                watcher.Error += (sender, args) => { foreach (var item in entries) QueueExternalChange(generation, item.Id); };
                watcher.EnableRaisingEvents = true;
                watchers.Add(watcher);
            }
        }
        private void OnClosing(object sender, FormClosingEventArgs args) {
            if (draggingDocument) { args.Cancel = true; return; }
            if (application.CancelTransfers(this, "窗口关闭操作取消了文档移交，原文档已保留。")) { args.Cancel = !allowClose; return; }
            if (allowClose || pageFailed || !frontendReady) return;
            args.Cancel = true;
            if (closeRequested) return;
            closeRequested = true;
            Notify("closeWorkspace");
        }
        protected override void Dispose(bool disposing) {
            if (disposing) {
                if (registeredWindow != IntPtr.Zero) ShellIntegration.RemoveProp(registeredWindow, windowIdentity);
                if (registeredWindow != IntPtr.Zero) ShellIntegration.RemoveProp(registeredWindow, "InkletWindow-" + WindowId);
                foreach (var watcher in watchers) watcher.Dispose();
                externalTimer.Dispose();
                browser.Dispose();
                if (resources != null) resources.Dispose();
            }
            base.Dispose(disposing);
        }
    }

    public static class Program {
        [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
        [STAThread]
        public static void Main(string[] args) {
            try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Inklet");
            string defaultProfile = profile;
            string file = null;
            string port = null;
            bool repairAssociation = args.Contains("--repair-association");
            for (int index = 0; index < args.Length; index++) {
                if (args[index] == "--profile" && index + 1 < args.Length) profile = Path.GetFullPath(args[++index]);
                else if (args[index] == "--debug-port" && index + 1 < args.Length) {
                    int value;
                    if (Int32.TryParse(args[++index], out value) && value >= 1024 && value <= 65535) port = value.ToString();
                } else if (File.Exists(args[index])) file = Path.GetFullPath(args[index]);
            }
            if (String.Equals(profile, defaultProfile, StringComparison.OrdinalIgnoreCase)) {
                try {
                    if (ShellIntegration.RefreshRegistration(Registry.CurrentUser, Application.ExecutablePath)) ShellIntegration.NotifyAssociationChange();
                } catch (Exception error) {
                    if (!(error is IOException) && !(error is UnauthorizedAccessException) && !(error is System.Security.SecurityException)) throw;
                    if (repairAssociation) { Environment.ExitCode = 1; return; }
                }
            }
            if (repairAssociation) return;
            bool created;
            string identity = ShellIntegration.Identity(profile);
            using (var mutex = new Mutex(true, "Local\\" + identity, out created)) {
                if (!created) {
                    if (!ShellIntegration.ForwardOpen(identity, file)) MessageBox.Show("已有 Inklet 窗口来自不同版本，或尚未就绪。为保护未保存内容，不会自动关闭或转交给其他版本。\n\n请先保存并关闭已有窗口，再打开当前版本。", "Inklet");
                    return;
                }
                try { Application.Run(new InkletApplication(profile, file, port)); }
                finally { mutex.ReleaseMutex(); }
            }
        }
    }
}
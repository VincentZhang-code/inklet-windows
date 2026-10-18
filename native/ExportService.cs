using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Inklet {
    public static class ExportService {
        public static async Task<object> Export(Form owner, WebView2 editor, FileStore store, IDictionary<string, object> args) {
            string format = Convert.ToString(args["format"]);
            if (format != "pdf" && format != "html" && format != "docx") throw new IOException("不支持的导出格式。");
            string name = Path.GetFileNameWithoutExtension(Convert.ToString(args["name"]));
            if (String.IsNullOrWhiteSpace(name)) name = "文档";
            string destination;
            using (var dialog = new SaveFileDialog {
                Title = "导出 " + format.ToUpperInvariant(), FileName = name + "." + format,
                Filter = format.ToUpperInvariant() + " 文档|*." + format,
                DefaultExt = format, AddExtension = true, OverwritePrompt = true,
            }) {
                if (dialog.ShowDialog(owner) != DialogResult.OK) return null;
                destination = Path.GetFullPath(dialog.FileName);
            }
            if (!String.Equals(Path.GetExtension(destination), "." + format, StringComparison.OrdinalIgnoreCase)) throw new IOException("导出文件扩展名必须为 ." + format);
            if (String.Equals(destination, store.CurrentPath, StringComparison.OrdinalIgnoreCase)) throw new IOException("不能用导出文件覆盖当前 Markdown。");
            if (format == "html") FileStore.AtomicWrite(destination, Encoding.UTF8.GetBytes(Convert.ToString(args["html"])), true);
            else if (format == "docx") {
                byte[] data = Convert.FromBase64String(Convert.ToString(args["data"]));
                if (data.Length < 4 || data[0] != 80 || data[1] != 75) throw new IOException("Word 文件生成失败。");
                FileStore.AtomicWrite(destination, data, true);
            } else {
                bool completed = await ExportPdf(owner, editor, store, Convert.ToString(args["html"]), destination);
                if (!completed) return null;
            }
            return new { path = destination, format = format };
        }

        private static async Task<bool> ExportPdf(Form owner, WebView2 editor, FileStore store, string html, string destination) {
            string temporary = Path.Combine(store.DataDirectory, "exports", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temporary);
            string input = Path.Combine(temporary, "document.html");
            string output = Path.Combine(temporary, "document.pdf");
            FileStore.AtomicWrite(input, Encoding.UTF8.GetBytes(html));
            var ready = new TaskCompletionSource<bool>();
            try {
                using (var window = new Form { Text = "正在导出 PDF", ClientSize = new Size(940, 700), StartPosition = FormStartPosition.CenterParent, ShowInTaskbar = false })
                using (var view = new WebView2 { Dock = DockStyle.Fill }) {
                    window.Controls.Add(view);
                    window.FormClosed += (sender, args) => ready.TrySetCanceled();
                    window.Show(owner);
                    owner.Enabled = false;
                    await view.EnsureCoreWebView2Async(editor.CoreWebView2.Environment);
                    var core = view.CoreWebView2;
                    core.Settings.AreDevToolsEnabled = false;
                    core.Settings.AreDefaultContextMenusEnabled = false;
                    core.Settings.IsStatusBarEnabled = false;
                    core.Settings.AreDefaultScriptDialogsEnabled = false;
                    core.SetVirtualHostNameToFolderMapping("inklet-export.local", temporary, CoreWebView2HostResourceAccessKind.DenyCors);
                    core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
                    core.WebResourceRequested += (sender, args) => {
                        Uri uri;
                        if (!Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out uri) || (uri.Host != "inklet-export.local" && uri.Scheme != "data" && uri.Scheme != "blob"))
                            args.Response = core.Environment.CreateWebResourceResponse(new MemoryStream(new byte[0]), 403, "Blocked", "Content-Type: text/plain");
                    };
                    core.NavigationStarting += (sender, args) => { if (!args.Uri.StartsWith("https://inklet-export.local/", StringComparison.Ordinal)) args.Cancel = true; };
                    core.NewWindowRequested += (sender, args) => args.Handled = true;
                    core.PermissionRequested += (sender, args) => args.State = CoreWebView2PermissionState.Deny;
                    core.DownloadStarting += (sender, args) => args.Cancel = true;
                    core.WebMessageReceived += (sender, args) => {
                        string message = args.TryGetWebMessageAsString();
                        if (message == "ready") ready.TrySetResult(true);
                        else ready.TrySetException(new IOException("导出图片未完成加载。"));
                    };
                    core.NavigationCompleted += async (sender, args) => {
                        if (!args.IsSuccess) { ready.TrySetException(new IOException("导出页面加载失败。")); return; }
                        try {
                            await core.ExecuteScriptAsync("(async()=>{try{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode()));window.chrome.webview.postMessage('ready');}catch{window.chrome.webview.postMessage('failed');}})()");
                        } catch (Exception error) {
                            if (view.IsDisposed) ready.TrySetCanceled();
                            else ready.TrySetException(error);
                        }
                    };
                    core.Navigate("https://inklet-export.local/document.html");
                    if (await Task.WhenAny(ready.Task, Task.Delay(30000)) != ready.Task) throw new IOException("PDF 排版超时。");
                    await ready.Task;
                    var settings = core.Environment.CreatePrintSettings();
                    settings.ShouldPrintBackgrounds = true;
                    settings.ShouldPrintHeaderAndFooter = false;
                    settings.PageWidth = 8.2677;
                    settings.PageHeight = 11.6929;
                    if (!await core.PrintToPdfAsync(output, settings)) throw new IOException("PDF 导出失败。");
                    byte[] data = File.ReadAllBytes(output);
                    if (data.Length < 5 || Encoding.ASCII.GetString(data, 0, 5) != "%PDF-") throw new IOException("生成的 PDF 无效。");
                    FileStore.AtomicWrite(destination, data, true);
                }
                return true;
            } catch (TaskCanceledException) { return false; }
            finally {
                owner.Enabled = true;
                owner.Activate();
                try { Directory.Delete(temporary, true); } catch (IOException) { }
            }
        }
    }
}
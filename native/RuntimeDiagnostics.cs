using System;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

namespace Inklet {
    public sealed class RuntimeDiagnostic {
        public string TimeUtc { get; set; }
        public string AppVersion { get; set; }
        public string WebViewVersion { get; set; }
        public string Kind { get; set; }
        public string Reason { get; set; }
        public int? ExitCode { get; set; }
        public string ExitCodeHex { get { return ExitCode.HasValue ? "0x" + unchecked((uint)ExitCode.Value).ToString("X8") : null; } }
        public bool Dirty { get; set; }
        public int DocumentLength { get; set; }
        public bool SearchActive { get; set; }
        public int QueryLength { get; set; }
        public int MatchCount { get; set; }
    }

    public sealed class RuntimeDiagnostics {
        public readonly string LogPath;
        public const int MaximumBytes = 256 * 1024;
        private readonly object sync = new object();
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();

        public RuntimeDiagnostics(string dataDirectory) { LogPath = Path.Combine(dataDirectory, "diagnostics", "runtime.jsonl"); }

        public void Append(RuntimeDiagnostic entry) {
            entry.TimeUtc = DateTimeOffset.UtcNow.ToString("O");
            byte[] bytes = new UTF8Encoding(false).GetBytes(json.Serialize(entry) + "\n");
            if (bytes.Length > MaximumBytes) throw new IOException("诊断记录过长。");
            lock (sync) {
                Directory.CreateDirectory(Path.GetDirectoryName(LogPath));
                if (File.Exists(LogPath) && new FileInfo(LogPath).Length + bytes.Length > MaximumBytes) {
                    string previous = LogPath + ".previous";
                    if (File.Exists(previous)) File.Delete(previous);
                    File.Move(LogPath, previous);
                }
                using (var stream = new FileStream(LogPath, FileMode.Append, FileAccess.Write, FileShare.Read, 4096, FileOptions.WriteThrough)) {
                    stream.Write(bytes, 0, bytes.Length);
                    stream.Flush(true);
                }
            }
        }
    }
}
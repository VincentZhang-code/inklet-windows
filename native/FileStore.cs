using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace Inklet {
    public sealed class FileStore {
        public readonly string DataDirectory;
        public readonly OpenHistory History;
        public readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024, RecursionLimit = 128 };
        public string CurrentPath { get; private set; }
        public string CurrentStamp { get; private set; }
        public string LineEnding { get; private set; }
        public bool HasBom { get; private set; }
        private string draftDirectory;
        private readonly bool isolatedDocument;
        private Dictionary<string, object> recoveryState;
        private bool journalIncomplete;
        private int journalRecords;
        private DiskSnapshot pendingExternal;
        private sealed class DiskSnapshot {
            public string Path, Stamp, Text, Ending;
            public bool Bom;
            public object Annotations;
            public object Payload() { return new { name = System.IO.Path.GetFileName(Path), path = Path, text = Text, hash = TextHash(Text), stamp = Stamp, annotations = Annotations }; }
        }
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        public string SourceDirectory { get { return CurrentPath == null ? draftDirectory : Path.GetDirectoryName(CurrentPath); } }

        public FileStore(string dataDirectory, string historyDirectory = null, bool isolatedDocument = false) {
            DataDirectory = Path.GetFullPath(dataDirectory);
            Directory.CreateDirectory(DataDirectory);
            History = new OpenHistory(historyDirectory ?? DataDirectory);
            this.isolatedDocument = isolatedDocument;
            draftDirectory = isolatedDocument ? Path.Combine(DataDirectory, "draft") : Path.Combine(DataDirectory, "drafts", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(draftDirectory);
            LineEnding = "\n";
        }

        public static string Hash(byte[] bytes) {
            using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        }
        public static string TextHash(string text) { return Hash(Utf8.GetBytes(text)); }
        public string Stamp(string path) { return File.Exists(path) ? Hash(File.ReadAllBytes(path)) : null; }

        public void RememberLastDocument() {
            AtomicWrite(Path.Combine(DataDirectory, "last-document.json"), Utf8.GetBytes(Json.Serialize(new { version = 1, path = CurrentPath })));
        }

        public string ReadLastDocumentPath() {
            string statePath = Path.Combine(DataDirectory, "last-document.json");
            if (!File.Exists(statePath)) return History.Read().Select(entry => entry.Path).FirstOrDefault();
            try {
                if (new FileInfo(statePath).Length > 65536) return null;
                var state = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(statePath, Utf8));
                object value;
                if (state == null || !state.TryGetValue("path", out value)) return null;
                string path = value as string;
                return String.IsNullOrWhiteSpace(path) || !Path.IsPathRooted(path) ? null : Path.GetFullPath(path);
            } catch (IOException) { } catch (UnauthorizedAccessException) { } catch (ArgumentException) { } catch (InvalidOperationException) { } catch (NotSupportedException) { }
            return null;
        }

        public static void AtomicWrite(string path, byte[] bytes, bool backup = false) {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path)));
            string temporary = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(path)), ".inklet-" + Guid.NewGuid().ToString("N") + ".tmp");
            try {
                using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                    stream.Write(bytes, 0, bytes.Length);
                    stream.Flush(true);
                }
                if (File.Exists(path)) {
                    string backupPath = null;
                    if (backup) {
                        string folder = Path.Combine(Path.GetDirectoryName(path), ".inklet-backups");
                        Directory.CreateDirectory(folder);
                        backupPath = Path.Combine(folder, Path.GetFileName(path) + ".bak");
                    }
                    File.Replace(temporary, path, backupPath);
                } else File.Move(temporary, path);
            } finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }

        private DiskSnapshot ReadSnapshot(string path) {
            path = Path.GetFullPath(path);
            var info = new FileInfo(path);
            if (!info.Exists) throw new FileNotFoundException("文件不存在。", path);
            if (info.Length > 24 * 1024 * 1024) throw new IOException("当前版本支持不超过 24 MB 的 Markdown 文件。");
            byte[] bytes = File.ReadAllBytes(path);
            bool bom = bytes.Length >= 3 && bytes[0] == 239 && bytes[1] == 187 && bytes[2] == 191;
            string text;
            try { text = Utf8.GetString(bytes, bom ? 3 : 0, bytes.Length - (bom ? 3 : 0)); }
            catch (DecoderFallbackException) { throw new IOException("文件不是有效的 UTF-8 编码，请先转换编码后打开。"); }
            if (text.IndexOf('\0') >= 0) throw new IOException("该文件包含二进制内容。");
            object annotations = null;
            string annotationPath = path + ".inklet.json";
            if (File.Exists(annotationPath)) {
                try { annotations = Json.DeserializeObject(File.ReadAllText(annotationPath, Utf8)); }
                catch { annotations = null; }
            }
            return new DiskSnapshot { Path = path, Stamp = Hash(bytes), Bom = bom, Ending = text.Contains("\r\n") ? "\r\n" : "\n", Text = text.Replace("\r\n", "\n"), Annotations = annotations };
        }

        private void AdoptSnapshot(DiskSnapshot snapshot) {
            CurrentPath = snapshot.Path;
            CurrentStamp = snapshot.Stamp;
            HasBom = snapshot.Bom;
            LineEnding = snapshot.Ending;
        }

        public object Open(string path) {
            DiskSnapshot snapshot = ReadSnapshot(path);
            AdoptSnapshot(snapshot);
            pendingExternal = null;
            string historyWarning = null;
            try { History.Record(snapshot.Path); }
            catch (IOException) { historyWarning = "文件已打开，但历史记录保存失败。"; }
            catch (UnauthorizedAccessException) { historyWarning = "文件已打开，但历史记录没有写入权限。"; }
            return new { name = Path.GetFileName(snapshot.Path), path = snapshot.Path, text = snapshot.Text, hash = TextHash(snapshot.Text), annotations = snapshot.Annotations, historyWarning = historyWarning };
        }

        public object ReadExternal(string path) {
            if (CurrentPath == null || !String.Equals(CurrentPath, path, StringComparison.OrdinalIgnoreCase)) return null;
            DiskSnapshot snapshot = ReadSnapshot(CurrentPath);
            if (snapshot.Stamp == CurrentStamp) return null;
            pendingExternal = snapshot;
            return snapshot.Payload();
        }

        public bool AcceptExternal(string path, string stamp) {
            if (pendingExternal == null || !String.Equals(CurrentPath, path, StringComparison.OrdinalIgnoreCase) ||
                !String.Equals(pendingExternal.Path, path, StringComparison.OrdinalIgnoreCase) || pendingExternal.Stamp != stamp) return false;
            AdoptSnapshot(pendingExternal);
            pendingExternal = null;
            ClearRecovery();
            return true;
        }

        public void New() {
            pendingExternal = null;
            CurrentPath = null;
            CurrentStamp = null;
            HasBom = false;
            LineEnding = "\n";
            draftDirectory = isolatedDocument ? Path.Combine(DataDirectory, "draft") : Path.Combine(DataDirectory, "drafts", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(draftDirectory);
            ClearRecovery();
        }

        public static string ResolveAsset(string directory, string relative) {
            return ResolveAssetWithin(directory, relative, directory);
        }

        private static string ResolveAssetWithin(string directory, string relative, string authorizedDirectory) {
            relative = Uri.UnescapeDataString(relative).Replace('/', Path.DirectorySeparatorChar);
            if (Path.IsPathRooted(relative) || relative.IndexOf(':') >= 0) throw new IOException("只允许访问文档目录内的图片。");
            string root = Path.GetFullPath(authorizedDirectory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            string full = Path.GetFullPath(Path.Combine(directory, relative));
            if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new IOException("图片路径超出了文档目录。");
            string current = Path.GetDirectoryName(full);
            while (current.Length >= root.TrimEnd(Path.DirectorySeparatorChar).Length) {
                if (Directory.Exists(current) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new IOException("图片目录不能是符号链接。");
                current = Path.GetDirectoryName(current);
                if (current == null) break;
            }
            if (File.Exists(full) && (File.GetAttributes(full) & FileAttributes.ReparsePoint) != 0) throw new IOException("图片不能是符号链接。");
            return full;
        }

        public string ResolveImagePath(string reference) {
            if (String.IsNullOrWhiteSpace(reference)) throw new IOException("图片路径为空。");
            string path;
            if (reference.StartsWith("file:", StringComparison.OrdinalIgnoreCase)) {
                Uri uri;
                if (!Uri.TryCreate(reference, UriKind.Absolute, out uri) || !uri.IsFile || uri.IsUnc) throw new IOException("不自动访问网络图片路径。");
                path = uri.LocalPath;
            } else path = Uri.UnescapeDataString(reference).Replace('/', Path.DirectorySeparatorChar);
            if (path.StartsWith(@"\\", StringComparison.Ordinal)) throw new IOException("不自动访问网络共享或设备图片路径，请先将图片复制到本机。");
            int colon = path.IndexOf(':');
            if (colon >= 0 && (colon != 1 || !Char.IsLetter(path[0]) || path.Length < 3 || path[2] != Path.DirectorySeparatorChar || path.IndexOf(':', 2) >= 0)) throw new IOException("仅支持相对或绝对本地图片路径。");
            if (path.StartsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal)) path = Path.Combine(Path.GetPathRoot(SourceDirectory), path.TrimStart(Path.DirectorySeparatorChar));
            return Path.GetFullPath(Path.IsPathRooted(path) ? path : Path.Combine(SourceDirectory, path));
        }

        public object ImportImage(string base64, string mime) {
            if (base64.Length > 36 * 1024 * 1024) throw new IOException("图片不能超过 25 MB。");
            var extensions = new Dictionary<string, string> { { "image/png", ".png" }, { "image/jpeg", ".jpg" }, { "image/webp", ".webp" }, { "image/gif", ".gif" }, { "image/bmp", ".bmp" } };
            if (!extensions.ContainsKey(mime)) throw new IOException("不支持的图片格式。");
            byte[] bytes = Convert.FromBase64String(base64);
            if (bytes.Length < 12 || bytes.Length > 25 * 1024 * 1024) throw new IOException("图片数据无效或过大。");
            bool valid = mime == "image/png" ? bytes[0] == 137 && bytes[1] == 80 && bytes[2] == 78 && bytes[3] == 71 :
                mime == "image/jpeg" ? bytes[0] == 255 && bytes[1] == 216 :
                mime == "image/gif" ? Encoding.ASCII.GetString(bytes, 0, 3) == "GIF" :
                mime == "image/bmp" ? bytes[0] == 66 && bytes[1] == 77 :
                Encoding.ASCII.GetString(bytes, 0, 4) == "RIFF" && Encoding.ASCII.GetString(bytes, 8, 4) == "WEBP";
            if (!valid) throw new IOException("图片内容与格式不一致。");
            string relative = ".inklet-assets/" + Hash(bytes).Substring(0, 24) + extensions[mime];
            string destination = ResolveAsset(SourceDirectory, relative);
            if (!File.Exists(destination)) AtomicWrite(destination, bytes);
            return new { path = relative };
        }

        public object ReadImage(string relative) {
            string path = ResolveImagePath(relative);
            var types = new Dictionary<string, string> { { ".png", "image/png" }, { ".jpg", "image/jpeg" }, { ".jpeg", "image/jpeg" }, { ".gif", "image/gif" }, { ".webp", "image/webp" }, { ".bmp", "image/bmp" }, { ".svg", "image/svg+xml" } };
            string extension = Path.GetExtension(path).ToLowerInvariant();
            string display = Uri.UnescapeDataString(relative);
            if (!types.ContainsKey(extension)) throw new IOException("不支持的图片格式：" + display + "。支持 PNG、JPEG、GIF、WebP、BMP 和 SVG。");
            if (!File.Exists(path)) throw new IOException("图片文件不存在：" + display);
            if (new FileInfo(path).Length > 32 * 1024 * 1024) throw new IOException("图片超过 32 MB：" + display);
            return new { mime = types[extension], data = Convert.ToBase64String(File.ReadAllBytes(path)) };
        }

        public object Save(string path, string text, IDictionary<string, object> annotations, IEnumerable<string> resources) {
            path = Path.GetFullPath(path);
            bool same = String.Equals(path, CurrentPath, StringComparison.OrdinalIgnoreCase);
            string expected = same ? CurrentStamp : Stamp(path);
            if (same && Stamp(path) != expected) throw new IOException("磁盘文件已被修改或删除。请另存为，或重新打开文件后比较。");
            string destinationDirectory = Path.GetDirectoryName(path);
            if (!String.Equals(SourceDirectory, destinationDirectory, StringComparison.OrdinalIgnoreCase)) {
                foreach (string resource in resources.Distinct()) {
                    if (String.IsNullOrEmpty(resource) || resource.StartsWith("data:", StringComparison.OrdinalIgnoreCase) || resource.Contains("://")) continue;
                    string original = ResolveImagePath(resource);
                    if (!File.Exists(original)) continue;
                    string destination;
                    try { destination = ResolveAsset(destinationDirectory, resource); }
                    catch (IOException) {
                        string referenced = Path.GetFullPath(Path.Combine(destinationDirectory, Uri.UnescapeDataString(resource).Replace('/', Path.DirectorySeparatorChar)));
                        if (String.Equals(original, referenced, StringComparison.OrdinalIgnoreCase)) continue;
                        throw new IOException("另存位置改变了父目录图片的相对路径，请保持资料目录结构；未向目标目录外复制图片。");
                    }
                    byte[] bytes = File.ReadAllBytes(original);
                    if (File.Exists(destination) && Hash(File.ReadAllBytes(destination)) != Hash(bytes)) throw new IOException("目标目录中存在不同内容的同名图片，请选择其他保存目录。");
                    if (!File.Exists(destination)) AtomicWrite(destination, bytes);
                }
            }
            if (Stamp(path) != expected) throw new IOException("保存前发现文件已变化，未覆盖磁盘内容。");
            string diskText = LineEnding == "\r\n" ? text.Replace("\r\n", "\n").Replace("\n", "\r\n") : text;
            byte[] contents = new UTF8Encoding(HasBom).GetBytes(diskText);
            if (HasBom) contents = new byte[] { 239, 187, 191 }.Concat(contents).ToArray();
            if (contents.Length > 24 * 1024 * 1024) throw new IOException("保存后的MD超过24MiB上限，请减少内容、压缩图片或关闭内嵌模式。");
            AtomicWrite(path, contents, true);
            CurrentPath = path;
            CurrentStamp = Hash(contents);
            string hash = TextHash(text);
            annotations["textHash"] = hash;
            AtomicWrite(path + ".inklet.json", Utf8.GetBytes(Json.Serialize(annotations)), true);
            ClearRecovery();
            return new { name = Path.GetFileName(path), path = path, hash = hash };
        }

        public void SaveRecovery(IDictionary<string, object> payload) {
            payload = new Dictionary<string, object>(payload);
            payload["assetDirectory"] = SourceDirectory;
            payload["lineEnding"] = LineEnding;
            payload["hasBom"] = HasBom;
            string data = Json.Serialize(payload);
            var envelope = new { format = "InkletRecoveryV1", data = data, checksum = TextHash(data) };
            AtomicWrite(Path.Combine(DataDirectory, "recovery.json"), Utf8.GetBytes(Json.Serialize(envelope)), true);
            string journal = Path.Combine(DataDirectory, "recovery.jsonl");
            if (File.Exists(journal)) File.Delete(journal);
            recoveryState = new Dictionary<string, object>(payload);
            journalRecords = 0;
            journalIncomplete = false;
        }

        private Dictionary<string, object> ApplyRecoveryDelta(Dictionary<string, object> previous, IDictionary<string, object> delta) {
            if (previous == null || !previous.ContainsKey("documentId") || !delta.ContainsKey("documentId") || Convert.ToString(previous["documentId"]) != Convert.ToString(delta["documentId"])) return null;
            if (!previous.ContainsKey("revision") || !delta.ContainsKey("baseRevision") || Convert.ToInt64(previous["revision"]) != Convert.ToInt64(delta["baseRevision"])) return null;
            if (Convert.ToInt64(delta["revision"]) <= Convert.ToInt64(delta["baseRevision"])) return null;
            var change = (IDictionary<string, object>)delta["change"];
            string text = Convert.ToString(previous["text"]);
            int from = Convert.ToInt32(change["from"]);
            int to = Convert.ToInt32(change["to"]);
            string insert = Convert.ToString(change["insert"]);
            if (from < 0 || to < from || to > text.Length) return null;
            var next = new Dictionary<string, object>(previous);
            next["text"] = text.Substring(0, from) + insert + text.Substring(to);
            foreach (string key in new[] { "revision", "annotations", "name", "path", "hash", "assetDirectory", "lineEnding", "hasBom" }) {
                if (delta.ContainsKey(key)) next[key] = delta[key];
            }
            return next;
        }

        public object AppendRecovery(IDictionary<string, object> payload) {
            if (recoveryState == null) recoveryState = Recovery() as Dictionary<string, object>;
            payload = new Dictionary<string, object>(payload);
            payload["assetDirectory"] = SourceDirectory;
            payload["lineEnding"] = LineEnding;
            payload["hasBom"] = HasBom;
            var next = ApplyRecoveryDelta(recoveryState, payload);
            if (next == null) return new { needsSnapshot = true };
            string journal = Path.Combine(DataDirectory, "recovery.jsonl");
            if (journalIncomplete || journalRecords >= 100 || (File.Exists(journal) && new FileInfo(journal).Length > 4 * 1024 * 1024)) {
                SaveRecovery(next);
            } else {
                string data = Json.Serialize(payload);
                byte[] bytes = Utf8.GetBytes(Json.Serialize(new { data = data, checksum = TextHash(data) }) + "\n");
                using (var stream = new FileStream(journal, FileMode.Append, FileAccess.Write, FileShare.Read, 4096, FileOptions.WriteThrough)) {
                    stream.Write(bytes, 0, bytes.Length);
                    stream.Flush(true);
                }
                recoveryState = next;
                journalRecords++;
            }
            return new { persisted = true, documentId = payload["documentId"], revision = payload["revision"] };
        }
        public object Recovery() {
            string[] candidates = { Path.Combine(DataDirectory, "recovery.json"), Path.Combine(DataDirectory, ".inklet-backups", "recovery.json.bak") };
            foreach (string path in candidates) {
                if (!File.Exists(path)) continue;
                try {
                    var stored = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(path, Utf8));
                    if (stored.ContainsKey("format")) {
                        if (Convert.ToString(stored["format"]) != "InkletRecoveryV1") continue;
                        string data = Convert.ToString(stored["data"]);
                        if (TextHash(data) != Convert.ToString(stored["checksum"])) continue;
                        stored = Json.Deserialize<Dictionary<string, object>>(data);
                    }
                    if (!stored.ContainsKey("text") || !(stored["text"] is string)) continue;
                    if (path == candidates[1]) stored["recoveredPreviousSnapshot"] = true;
                    string journal = Path.Combine(DataDirectory, "recovery.jsonl");
                    journalIncomplete = false;
                    journalRecords = 0;
                    if (File.Exists(journal)) {
                        using (var reader = new StreamReader(journal, Utf8)) {
                            string line;
                            while ((line = reader.ReadLine()) != null) {
                                try {
                                    var frame = Json.Deserialize<Dictionary<string, object>>(line);
                                    string data = Convert.ToString(frame["data"]);
                                    if (TextHash(data) != Convert.ToString(frame["checksum"])) throw new IOException();
                                    var delta = Json.Deserialize<Dictionary<string, object>>(data);
                                    if (stored.ContainsKey("documentId") && Convert.ToString(stored["documentId"]) == Convert.ToString(delta["documentId"]) && Convert.ToInt64(delta["revision"]) <= Convert.ToInt64(stored["revision"])) continue;
                                    var next = ApplyRecoveryDelta(stored, delta);
                                    if (next == null) throw new IOException();
                                    stored = next;
                                    journalRecords++;
                                } catch { journalIncomplete = true; break; }
                            }
                        }
                    }
                    if (journalIncomplete) stored["recoveredPartialJournal"] = true;
                    recoveryState = stored;
                    return stored;
                } catch { }
            }
            return null;
        }
        public void ClearRecovery() {
            foreach (string path in new[] { Path.Combine(DataDirectory, "recovery.json"), Path.Combine(DataDirectory, ".inklet-backups", "recovery.json.bak"), Path.Combine(DataDirectory, "recovery.jsonl") }) {
                if (File.Exists(path)) File.Delete(path);
            }
            recoveryState = null;
            journalRecords = 0;
            journalIncomplete = false;
        }
        public void ReleaseRecoveryCache() { recoveryState = null; pendingExternal = null; }
        public void Recover(IDictionary<string, object> recovery) {
            object value;
            CurrentPath = null;
            CurrentStamp = null;
            string originalPath = recovery.TryGetValue("path", out value) ? value as string : null;
            if (!String.IsNullOrEmpty(originalPath) && File.Exists(originalPath)) {
                var opened = Json.Deserialize<Dictionary<string, object>>(Json.Serialize(Open(originalPath)));
                string expectedHash = recovery.TryGetValue("hash", out value) ? value as string : null;
                if (expectedHash != Convert.ToString(opened["hash"])) {
                    CurrentPath = null;
                    CurrentStamp = null;
                }
            }
            if (recovery.TryGetValue("assetDirectory", out value) && value is string && Directory.Exists((string)value)) draftDirectory = (string)value;
            if (recovery.TryGetValue("lineEnding", out value)) LineEnding = Convert.ToString(value) == "\r\n" ? "\r\n" : "\n";
            if (recovery.TryGetValue("hasBom", out value) && value is bool) HasBom = (bool)value;
        }
    }
}
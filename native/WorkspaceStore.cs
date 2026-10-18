using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

namespace Inklet {
    public sealed class WorkspaceDocument {
        public string Id, Path, Name;
        public bool Dirty, Loaded, Recovered;
        internal string Owner, IncomingOwner;
        internal FileStore Store;
        public object Info() { return new { id = Id, path = Path, name = Name, dirty = Dirty, recovered = Recovered }; }
    }

    public sealed class WorkspaceStore {
        private readonly FileStore host;
        private readonly string directory;
        private readonly Dictionary<string, WorkspaceDocument> documents = new Dictionary<string, WorkspaceDocument>();
        private readonly string owner;
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        public WorkspaceStore(FileStore hostStore) {
            host = hostStore;
            directory = Path.Combine(host.DataDirectory, "workspace");
            Directory.CreateDirectory(directory);
            string manifest = Path.Combine(directory, "index.json");
            if (!File.Exists(manifest)) return;
            var index = host.Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(manifest, Utf8));
            if (Convert.ToInt32(index["version"]) != 1) throw new IOException("工作空间记录版本不支持，原恢复数据已保留。");
            foreach (Dictionary<string, object> item in (IEnumerable)index["documents"]) {
                string id = Convert.ToString(item["id"]);
                ValidateId(id);
                string folder = Path.Combine(directory, id);
                if (!File.Exists(Path.Combine(folder, "recovery.json")) && !File.Exists(Path.Combine(folder, ".inklet-backups", "recovery.json.bak"))) continue;
                documents[id] = new WorkspaceDocument { Id = id, Path = item["path"] as string, Name = Convert.ToString(item["name"]), Dirty = true, Recovered = true };
            }
        }
        private static void ValidateId(string id) {
            Guid parsed;
            if (id == null || id.Length != 32 || !Guid.TryParseExact(id, "N", out parsed)) throw new IOException("文档身份无效。");
        }
        private WorkspaceStore(WorkspaceStore shared, string windowId) {
            host = shared.host; directory = shared.directory; documents = shared.documents; owner = windowId;
        }
        public WorkspaceStore ForWindow(string windowId) {
            ValidateId(windowId);
            return new WorkspaceStore(this, windowId);
        }
        private bool Visible(WorkspaceDocument item) { return owner == null || item.Owner == owner || item.IncomingOwner == owner; }
        public WorkspaceDocument[] Documents { get { return documents.Values.Where(Visible).ToArray(); } }
        public object[] List() { return Documents.Select(item => item.Info()).ToArray(); }
        public void ClaimRecovered() {
            if (owner == null) return;
            foreach (var item in documents.Values.Where(item => item.Owner == null)) item.Owner = owner;
        }
        public WorkspaceDocument FindPath(string path) {
            string full = Path.GetFullPath(path);
            return documents.Values.FirstOrDefault(item => String.Equals(item.Path, full, StringComparison.OrdinalIgnoreCase));
        }
        public string OwnerOf(string id) { return Get(id).Owner; }
        public WorkspaceDocument Get(string id) {
            WorkspaceDocument item;
            if (id == null || !documents.TryGetValue(id, out item) || !Visible(item)) throw new IOException("文档已关闭或不属于当前窗口。");
            return item;
        }
        public void EnsureWritable(string id) {
            var item = Get(id);
            if (item.IncomingOwner != null) throw new IOException("文档正在移交窗口，请稍后再试。");
            if (owner != null && item.Owner != owner) throw new IOException("当前窗口不能修改此文档。");
        }
        public void StageMove(string id, WorkspaceStore destination) {
            EnsureWritable(id);
            if (!Object.ReferenceEquals(documents, destination.documents) || destination.owner == null || destination.owner == owner) throw new IOException("目标窗口无效。");
            Get(id).IncomingOwner = destination.owner;
        }
        public void CommitMove(string id, WorkspaceStore destination) {
            var item = Get(id);
            if (!Object.ReferenceEquals(documents, destination.documents) || item.IncomingOwner != destination.owner) throw new IOException("文档移交状态已失效。");
            item.Owner = destination.owner; item.IncomingOwner = null;
        }
        public void CancelMove(string id, WorkspaceStore destination) {
            var item = Get(id);
            if (Object.ReferenceEquals(documents, destination.documents) && item.IncomingOwner == destination.owner) item.IncomingOwner = null;
        }
        public FileStore Store(string id) {
            var item = Get(id);
            if (item.Store == null) item.Store = new FileStore(Path.Combine(directory, id), host.DataDirectory, true);
            return item.Store;
        }
        private void WriteIndex(IEnumerable<WorkspaceDocument> entries) {
            FileStore.AtomicWrite(Path.Combine(directory, "index.json"), Utf8.GetBytes(host.Json.Serialize(new { version = 1, documents = entries.Select(item => item.Info()).ToArray() })), true);
        }
        public WorkspaceDocument Add(string path) {
            if (path != null) {
                path = Path.GetFullPath(path);
                var existing = documents.Values.FirstOrDefault(item => String.Equals(item.Path, path, StringComparison.OrdinalIgnoreCase));
                if (existing != null) {
                    if (!Visible(existing)) throw new IOException("文件已在其他窗口打开。");
                    return existing;
                }
                var info = new FileInfo(path);
                if (!info.Exists) throw new FileNotFoundException("文件不存在。", path);
                if (info.Length > 24 * 1024 * 1024) throw new IOException("当前版本支持不超过 24 MB 的 Markdown 文件。");
            }
            var document = new WorkspaceDocument { Id = Guid.NewGuid().ToString("N"), Path = path, Name = path == null ? "未命名.md" : Path.GetFileName(path), Owner = owner };
            documents.Add(document.Id, document);
            try { WriteIndex(documents.Values); } catch { documents.Remove(document.Id); throw; }
            return document;
        }
        public object Load(string id) {
            var item = Get(id);
            if (item.Loaded && item.Dirty && !item.Recovered) throw new IOException("文档已有未保存内容，请恢复已有会话。");
            var file = Store(id);
            object data;
            if (item.Recovered) {
                var recovery = file.Recovery() as Dictionary<string, object>;
                if (recovery == null) throw new IOException("恢复副本无法读取，原数据已保留。");
                file.Recover(recovery);
                item.Path = file.CurrentPath;
                recovery["path"] = item.Path; recovery["id"] = id; recovery["restored"] = true;
                data = recovery;
            } else if (item.Path == null) data = new { id = id, name = item.Name, path = (string)null, text = "" };
            else {
                var opened = host.Json.Deserialize<Dictionary<string, object>>(host.Json.Serialize(file.Open(item.Path)));
                opened["id"] = id;
                data = opened;
            }
            item.Loaded = true;
            return data;
        }
        public void MarkDirty(string id, bool dirty) {
            EnsureWritable(id);
            var item = Get(id);
            if (item.Dirty == dirty) return;
            bool previous = item.Dirty;
            item.Dirty = dirty;
            try { WriteIndex(documents.Values); } catch { item.Dirty = previous; throw; }
        }
        public void ValidateDestination(string id, string path) {
            EnsureWritable(id);
            path = Path.GetFullPath(path);
            if (documents.Values.Any(item => item.Id != id && String.Equals(item.Path, path, StringComparison.OrdinalIgnoreCase))) throw new IOException("目标文件已在工作空间打开，请先切换到该文件处理，或选择其他文件名。");
        }
        public object Save(string id, string path, string text, IDictionary<string, object> annotations, IEnumerable<string> resources) {
            ValidateDestination(id, path);
            var saved = host.Json.Deserialize<Dictionary<string, object>>(host.Json.Serialize(Store(id).Save(path, text, annotations, resources)));
            var item = Get(id);
            item.Path = Convert.ToString(saved["path"]); item.Name = Convert.ToString(saved["name"]); item.Dirty = false; item.Recovered = false;
            WriteIndex(documents.Values);
            saved["documentId"] = id;
            return saved;
        }
        public object SaveSession(string id, Dictionary<string, object> snapshot) {
            EnsureWritable(id);
            if (Convert.ToString(snapshot["documentId"]) != id || Convert.ToInt32(snapshot["version"]) != 1) throw new IOException("会话与文档不匹配。");
            var session = (Dictionary<string, object>)snapshot["session"];
            var info = (Dictionary<string, object>)snapshot["info"];
            long revision = Convert.ToInt64(session["revision"]);
            bool dirty = Convert.ToInt64(snapshot["savedRevision"]) != revision;
            string json = host.Json.Serialize(snapshot);
            byte[] bytes = Utf8.GetBytes(host.Json.Serialize(new { version = 1, data = json, checksum = FileStore.TextHash(json) }));
            string destination = Path.Combine(Store(id).DataDirectory, "session.json");
            long total = Directory.GetFiles(directory, "session.json", SearchOption.AllDirectories).Where(path => path != destination).Sum(path => new FileInfo(path).Length);
            if (bytes.Length > 64 * 1024 * 1024 || total + bytes.Length > 512L * 1024 * 1024) throw new IOException("文档缓存已达到保护上限，请保存并关闭部分文件后再试；当前内容未释放。");
            FileStore.AtomicWrite(destination, bytes);
            if (dirty) Store(id).SaveRecovery(new Dictionary<string, object> {
                { "documentId", id }, { "revision", revision }, { "text", session["source"] },
                { "name", info["name"] }, { "path", info["path"] }, { "hash", info["hash"] },
                { "annotations", snapshot.ContainsKey("annotations") ? snapshot["annotations"] : null }
            });
            MarkDirty(id, dirty);
            Store(id).ReleaseRecoveryCache();
            return new { persisted = true, documentId = id, revision = revision };
        }
        public object ReadSession(string id) {
            Get(id);
            string path = Path.Combine(Store(id).DataDirectory, "session.json");
            if (!File.Exists(path)) throw new IOException("文档缓存不存在，未覆盖当前文档。");
            var envelope = host.Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(path, Utf8));
            string json = Convert.ToString(envelope["data"]);
            if (FileStore.TextHash(json) != Convert.ToString(envelope["checksum"])) throw new IOException("文档缓存校验失败，原数据已保留。");
            var snapshot = host.Json.Deserialize<Dictionary<string, object>>(json);
            if (Convert.ToString(snapshot["documentId"]) != id) throw new IOException("文档缓存身份不匹配。");
            return snapshot;
        }
        public void Close(string[] ids, bool discard) {
            foreach (string id in ids) {
                EnsureWritable(id);
                if (Get(id).Dirty && !discard) throw new IOException("仍有未保存文档，关闭已取消。");
            }
            var selected = new HashSet<string>(ids);
            WriteIndex(documents.Values.Where(item => !selected.Contains(item.Id)));
            foreach (string id in ids) {
                documents.Remove(id);
                try { Directory.Delete(Path.Combine(directory, id), true); } catch (DirectoryNotFoundException) { } catch (IOException) { } catch (UnauthorizedAccessException) { }
            }
        }
        public WorkspaceDocument ImportLegacyRecovery() {
            var recovery = host.Recovery() as Dictionary<string, object>;
            if (recovery == null) return null;
            var item = Add(null);
            item.Name = recovery.ContainsKey("name") ? Convert.ToString(recovery["name"]) : "未命名.md";
            item.Path = recovery.ContainsKey("path") ? recovery["path"] as string : null;
            recovery["documentId"] = item.Id;
            Store(item.Id).Recover(recovery);
            Store(item.Id).SaveRecovery(recovery);
            MarkDirty(item.Id, true); item.Recovered = true;
            host.ClearRecovery();
            return item;
        }
    }
}
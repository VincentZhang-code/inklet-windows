using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;

namespace Inklet {
    public sealed class OpenHistoryEntry {
        public string Id { get; set; }
        public string Path { get; set; }
        public string Name { get; set; }
        public string OpenedAt { get; set; }
    }

    public sealed class ReadingPosition {
        public string Path { get; set; }
        public string Hash { get; set; }
        public int SourcePosition { get; set; }
        public string Heading { get; set; }
        public int HeadingLevel { get; set; }
        public int HeadingOccurrence { get; set; }
        public double BlockProgress { get; set; }
        public bool HasTextAnchor { get; set; }
        public double TextProgress { get; set; }
        public string ActivePane { get; set; }
        public double FallbackScrollTop { get; set; }
        public string UpdatedAt { get; set; }
    }

    public sealed class ReadingHistory {
        private readonly string directory;
        private readonly object sync = new object();
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 2 * 1024 * 1024 };
        public const int MaximumEntries = 500;
        public ReadingHistory(string dataDirectory) { directory = dataDirectory; }

        private static bool Valid(ReadingPosition entry) {
            DateTimeOffset timestamp;
            if (entry == null || String.IsNullOrWhiteSpace(entry.Path) || entry.SourcePosition < 0 || entry.SourcePosition > 24 * 1024 * 1024) return false;
            if (entry.HeadingLevel < 0 || entry.HeadingLevel > 6 || entry.HeadingOccurrence < 0 || entry.HeadingOccurrence > 100000) return false;
            if (entry.Heading != null && entry.Heading.Length > 512) return false;
            if (Double.IsNaN(entry.BlockProgress) || Double.IsInfinity(entry.BlockProgress) || entry.BlockProgress < 0 || entry.BlockProgress > 1) return false;
            if (Double.IsNaN(entry.TextProgress) || Double.IsInfinity(entry.TextProgress) || entry.TextProgress < 0 || entry.TextProgress > 1) return false;
            if (Double.IsNaN(entry.FallbackScrollTop) || Double.IsInfinity(entry.FallbackScrollTop) || entry.FallbackScrollTop < 0 || entry.FallbackScrollTop > 1000000000) return false;
            if (entry.ActivePane != "source" && entry.ActivePane != "rich") return false;
            if (!DateTimeOffset.TryParse(entry.UpdatedAt, CultureInfo.InvariantCulture, DateTimeStyles.None, out timestamp)) return false;
            if (!String.IsNullOrEmpty(entry.Hash) && (entry.Hash.Length != 64 || entry.Hash.Any(character => !Uri.IsHexDigit(character)))) return false;
            try {
                string extension = System.IO.Path.GetExtension(entry.Path);
                return System.IO.Path.IsPathRooted(entry.Path) && (extension.Equals(".md", StringComparison.OrdinalIgnoreCase) || extension.Equals(".markdown", StringComparison.OrdinalIgnoreCase));
            } catch (ArgumentException) { return false; }
        }

        private List<ReadingPosition> ReadAll() {
            foreach (string file in new[] { System.IO.Path.Combine(directory, "reading-positions.json"), System.IO.Path.Combine(directory, ".inklet-backups", "reading-positions.json.bak") }) {
                if (!File.Exists(file)) continue;
                try {
                    if (new FileInfo(file).Length > 2 * 1024 * 1024) continue;
                    var entries = json.Deserialize<List<ReadingPosition>>(File.ReadAllText(file, Encoding.UTF8));
                    if (entries != null) return entries.Where(Valid).GroupBy(entry => System.IO.Path.GetFullPath(entry.Path), StringComparer.OrdinalIgnoreCase).Select(group => group.First()).Take(MaximumEntries).ToList();
                } catch (IOException) { } catch (UnauthorizedAccessException) { } catch (ArgumentException) { } catch (InvalidOperationException) { }
            }
            return new List<ReadingPosition>();
        }

        public ReadingPosition Read(string path) {
            if (String.IsNullOrWhiteSpace(path)) return null;
            path = System.IO.Path.GetFullPath(path);
            lock (sync) return ReadAll().FirstOrDefault(entry => String.Equals(System.IO.Path.GetFullPath(entry.Path), path, StringComparison.OrdinalIgnoreCase));
        }

        public void Record(ReadingPosition entry) {
            if (entry == null || String.IsNullOrWhiteSpace(entry.Path)) throw new ArgumentException("Reading position requires a saved Markdown path.");
            entry.Path = System.IO.Path.GetFullPath(entry.Path);
            entry.UpdatedAt = DateTimeOffset.UtcNow.ToString("O");
            if (!Valid(entry)) throw new ArgumentException("Invalid reading position.");
            lock (sync) {
                var entries = ReadAll();
                entries.RemoveAll(previous => String.Equals(System.IO.Path.GetFullPath(previous.Path), entry.Path, StringComparison.OrdinalIgnoreCase));
                entries.Insert(0, entry);
                FileStore.AtomicWrite(System.IO.Path.Combine(directory, "reading-positions.json"), new UTF8Encoding(false).GetBytes(json.Serialize(entries.Take(MaximumEntries).ToList())), true);
            }
        }
    }

    public sealed class OpenHistory {
        private readonly string directory;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 2 * 1024 * 1024 };
        public const int MaximumEntries = 200;

        public OpenHistory(string dataDirectory) { directory = dataDirectory; }

        public List<OpenHistoryEntry> Read() {
            foreach (string file in new[] { System.IO.Path.Combine(directory, "open-history.json"), System.IO.Path.Combine(directory, ".inklet-backups", "open-history.json.bak") }) {
                if (!File.Exists(file)) continue;
                try {
                    if (new FileInfo(file).Length > 2 * 1024 * 1024) continue;
                    var entries = json.Deserialize<List<OpenHistoryEntry>>(File.ReadAllText(file, Encoding.UTF8));
                    if (entries == null) continue;
                    return entries.Where(entry => Valid(entry)).Take(MaximumEntries).ToList();
                } catch (IOException) { } catch (UnauthorizedAccessException) { } catch (ArgumentException) { } catch (InvalidOperationException) { }
            }
            return new List<OpenHistoryEntry>();
        }

        private static bool Valid(OpenHistoryEntry entry) {
            DateTimeOffset timestamp;
            if (entry == null || String.IsNullOrWhiteSpace(entry.Id) || String.IsNullOrWhiteSpace(entry.Path) || String.IsNullOrWhiteSpace(entry.Name)) return false;
            if (!DateTimeOffset.TryParse(entry.OpenedAt, CultureInfo.InvariantCulture, DateTimeStyles.None, out timestamp)) return false;
            try {
                string extension = System.IO.Path.GetExtension(entry.Path);
                return System.IO.Path.IsPathRooted(entry.Path) && (extension.Equals(".md", StringComparison.OrdinalIgnoreCase) || extension.Equals(".markdown", StringComparison.OrdinalIgnoreCase));
            } catch (ArgumentException) { return false; }
        }

        public void Record(string path) {
            path = System.IO.Path.GetFullPath(path);
            var entry = new OpenHistoryEntry { Id = Guid.NewGuid().ToString("N"), Path = path, Name = System.IO.Path.GetFileName(path), OpenedAt = DateTimeOffset.UtcNow.ToString("O") };
            if (!Valid(entry)) return;
            var entries = Read();
            entries.Insert(0, entry);
            FileStore.AtomicWrite(System.IO.Path.Combine(directory, "open-history.json"), new UTF8Encoding(false).GetBytes(json.Serialize(entries.Take(MaximumEntries).ToList())), true);
        }

        public string Resolve(string id) {
            var entry = Read().FirstOrDefault(candidate => candidate.Id == id);
            if (entry == null) throw new IOException("该历史记录已不存在，请刷新列表。");
            if (!File.Exists(entry.Path)) throw new FileNotFoundException("原地址无该文件。\n" + entry.Path, entry.Path);
            return entry.Path;
        }
    }
}
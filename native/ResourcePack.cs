using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;

namespace Inklet {
    public sealed class ResourcePack : IDisposable {
        private readonly ZipArchive archive;
        private readonly Dictionary<string, ZipArchiveEntry> entries = new Dictionary<string, ZipArchiveEntry>(StringComparer.Ordinal);
        private readonly object gate = new object();
        private static readonly Dictionary<string, string> contentTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
            { ".html", "text/html; charset=utf-8" }, { ".js", "text/javascript; charset=utf-8" },
            { ".css", "text/css; charset=utf-8" }, { ".json", "application/json; charset=utf-8" },
            { ".png", "image/png" }, { ".jpg", "image/jpeg" }, { ".jpeg", "image/jpeg" },
            { ".svg", "image/svg+xml" }, { ".ico", "image/x-icon" }, { ".woff", "font/woff" },
            { ".woff2", "font/woff2" }, { ".wasm", "application/wasm" }, { ".txt", "text/plain; charset=utf-8" },
        };

        public ResourcePack(string fileName) {
            archive = ZipFile.OpenRead(fileName);
            foreach (var entry in archive.Entries) {
                string name = entry.FullName.Replace('\\', '/');
                if (!name.EndsWith("/", StringComparison.Ordinal)) entries[name] = entry;
            }
        }

        public Stream Open(string resource, out string contentType) {
            contentType = "application/octet-stream";
            if (String.IsNullOrEmpty(resource)) resource = "index.html";
            if (resource.StartsWith("/", StringComparison.Ordinal) || resource.IndexOf('\\') >= 0 || resource.IndexOf(':') >= 0 || resource.IndexOf('\0') >= 0) return null;
            foreach (string segment in resource.Split('/')) if (segment == ".." || segment == ".") return null;
            lock (gate) {
                ZipArchiveEntry entry;
                if (!entries.TryGetValue(resource, out entry) || entry.Length > 32 * 1024 * 1024) return null;
                string knownType;
                if (contentTypes.TryGetValue(Path.GetExtension(resource), out knownType)) contentType = knownType;
                var result = new MemoryStream((int)entry.Length);
                try {
                    using (var source = entry.Open()) source.CopyTo(result);
                    result.Position = 0;
                    return result;
                } catch { result.Dispose(); throw; }
            }
        }

        public void Dispose() { lock (gate) archive.Dispose(); }
    }
}
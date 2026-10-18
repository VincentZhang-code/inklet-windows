using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text;
using Microsoft.Win32;
using Inklet;

public static class FileStoreTests {
    private static int checks;
    private static void Assert(bool condition, string name) {
        if (!condition) throw new Exception("FAIL: " + name);
        checks++;
        Console.WriteLine("PASS: " + name);
    }
    private static void VerifyWorkspace(string root) {
        var host = new FileStore(Path.Combine(root, "workspace-profile"));
        var workspace = new WorkspaceStore(host);
        string firstPath = Path.Combine(root, "first.md"), secondPath = Path.Combine(root, "second.md");
        File.WriteAllText(firstPath, "first"); File.WriteAllText(secondPath, "second");
        var first = workspace.Add(firstPath); var second = workspace.Add(secondPath);
        Assert(workspace.Add(firstPath.ToUpperInvariant()).Id == first.Id && workspace.Documents.Length == 2, "workspace deduplicates Windows paths without opening another buffer");
        Assert(!first.Loaded && !second.Loaded, "workspace file list is lazy");
        workspace.Load(first.Id); workspace.Load(second.Id);
        var retried = (Dictionary<string, object>)workspace.Load(second.Id);
        Assert((string)retried["text"] == "second", "a cancelled activation may reload a clean target without losing another buffer");
        workspace.Store(first.Id).SaveRecovery(new Dictionary<string, object> { { "documentId", first.Id }, { "revision", 1 }, { "text", "first draft" } });
        workspace.MarkDirty(first.Id, true);
        bool dirtyReloadBlocked = false;
        try { workspace.Load(first.Id); } catch (IOException) { dirtyReloadBlocked = true; }
        Assert(dirtyReloadBlocked, "dirty loaded documents cannot be replaced by an accidental disk reload");
        workspace.Store(second.Id).SaveRecovery(new Dictionary<string, object> { { "documentId", second.Id }, { "revision", 2 }, { "text", "second draft" } });
        workspace.MarkDirty(second.Id, true);
        Assert(workspace.Store(first.Id).DataDirectory != workspace.Store(second.Id).DataDirectory, "each document has a separate recovery directory");
        bool blocked = false;
        try { workspace.Save(first.Id, secondPath, "wrong", new Dictionary<string, object>(), new string[0]); } catch (IOException) { blocked = true; }
        Assert(blocked && File.ReadAllText(secondPath) == "second", "save as cannot overwrite another open document");
        workspace.Save(first.Id, firstPath, "first saved", new Dictionary<string, object>(), new string[0]);
        Assert(workspace.Store(second.Id).Recovery() != null && File.ReadAllText(secondPath) == "second", "saving one file preserves another file's recovery and contents");
        var restarted = new WorkspaceStore(new FileStore(host.DataDirectory));
        Assert(restarted.Documents.Length == 1 && restarted.Documents[0].Id == second.Id, "restart discovers unsaved documents without restoring clean sessions");
        blocked = false;
        try { workspace.Close(new[] { first.Id, second.Id }, false); } catch (IOException) { blocked = true; }
        Assert(blocked && workspace.Documents.Length == 2, "close all is cancelled while any file remains dirty");
        workspace.Close(new[] { first.Id }, false);
        Assert(workspace.Store(second.Id).Recovery() != null, "closing one file does not delete another recovery journal");
        workspace.Close(new[] { second.Id }, true);
        Assert(new WorkspaceStore(new FileStore(host.DataDirectory)).Documents.Length == 0, "normal close does not reopen the previous workspace");
        var cached = workspace.Add(firstPath); workspace.Load(cached.Id);
        var snapshot = new Dictionary<string, object> {
            { "version", 1 }, { "documentId", cached.Id }, { "savedRevision", 0 },
            { "info", new Dictionary<string, object> { { "name", "first.md" }, { "path", firstPath }, { "hash", FileStore.TextHash("first saved") } } },
            { "session", new Dictionary<string, object> { { "source", "cache draft" }, { "revision", 3 }, { "past", new object[0] } } },
            { "annotations", new { marks = new[] { new { from = 0, to = 5, color = "blue", quote = "cache" } } } }
        };
        var acknowledged = (Dictionary<string, object>)host.Json.DeserializeObject(host.Json.Serialize(workspace.SaveSession(cached.Id, snapshot)));
        Assert((bool)acknowledged["persisted"] && (string)acknowledged["documentId"] == cached.Id && Convert.ToInt32(acknowledged["revision"]) == 3, "cold storage acknowledges the matching document and revision");
        var stored = (Dictionary<string, object>)workspace.ReadSession(cached.Id);
        Assert((string)((Dictionary<string, object>)stored["session"])["source"] == "cache draft", "cold storage retains document state without reading the disk original");
        var restartedCache = new WorkspaceStore(new FileStore(host.DataDirectory));
        var restoredCache = (Dictionary<string, object>)restartedCache.Load(cached.Id);
        Assert((string)restoredCache["text"] == "cache draft" && restoredCache["annotations"] != null, "cold storage preserves recovery text and annotations after restart");
        string cachePath = Path.Combine(workspace.Store(cached.Id).DataDirectory, "session.json");
        File.WriteAllText(cachePath, File.ReadAllText(cachePath).Replace("cache draft", "wrong draft"));
        blocked = false;
        try { workspace.ReadSession(cached.Id); } catch (IOException) { blocked = true; }
        Assert(blocked, "corrupt cold storage is rejected without loading mismatched content");
        workspace.Close(new[] { cached.Id }, true);
        string longProfile = Path.Combine(root, new string('p', Math.Max(8, 125 - root.Length)));
        var longWorkspace = new WorkspaceStore(new FileStore(longProfile));
        var longDraft = longWorkspace.Add(null); longWorkspace.Load(longDraft.Id);
        string imageData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
        var picture = (Dictionary<string, object>)host.Json.DeserializeObject(host.Json.Serialize(longWorkspace.Store(longDraft.Id).ImportImage(imageData, "image/png")));
        Assert(File.Exists(FileStore.ResolveAsset(longWorkspace.Store(longDraft.Id).SourceDirectory, (string)picture["path"])), "isolated draft image writes keep long profile paths within native path limits");
    }
    private static void VerifyWindowOwnership(string root) {
        var shared = new WorkspaceStore(new FileStore(Path.Combine(root, "window-profile")));
        var source = shared.ForWindow(Guid.NewGuid().ToString("N"));
        var destination = shared.ForWindow(Guid.NewGuid().ToString("N"));
        var document = source.Add(null); source.Load(document.Id);
        var sourceStore = source.Store(document.Id);
        sourceStore.SaveRecovery(new Dictionary<string, object> { { "text", "unsaved window draft" }, { "documentId", document.Id }, { "revision", 4 } });
        source.MarkDirty(document.Id, true);
        var sibling = destination.Add(null); destination.Load(sibling.Id);
        Assert(source.Documents.Length == 1 && destination.Documents.Length == 1, "windows list only their own documents");
        bool rejected = false;
        try { destination.Close(new[] { document.Id }, true); } catch (IOException) { rejected = true; }
        Assert(rejected && source.Documents.Length == 1, "a window cannot close another window's document");
        source.StageMove(document.Id, destination);
        Assert(source.Documents.Length == 1 && destination.Documents.Length == 2, "staged move keeps the source until target acknowledgement");
        rejected = false;
        try { destination.MarkDirty(document.Id, false); } catch (IOException) { rejected = true; }
        Assert(rejected, "staged target cannot write or clear the source draft");
        source.CancelMove(document.Id, destination);
        Assert(source.Documents.Length == 1 && destination.Documents.Length == 1 && sourceStore.Recovery() != null, "failed window creation rolls ownership back without clearing recovery");
        source.StageMove(document.Id, destination); source.CommitMove(document.Id, destination);
        Assert(source.Documents.Length == 0 && destination.Documents.Length == 2, "acknowledged move transfers ownership exactly once");
        Assert(Object.ReferenceEquals(sourceStore, destination.Store(document.Id)), "window transfer preserves the file baseline and draft image directory");
        source.Close(new string[0], false);
        Assert(destination.Store(document.Id).Recovery() != null, "closing the source window preserves the transferred draft");
        destination.Close(new[] { sibling.Id }, false);
        Assert(destination.Documents.Length == 1, "closing a sibling document leaves the moved document intact");
        destination.Close(new[] { document.Id }, true);
    }
    private static void VerifyRelativeImageAccess(string root) {
        string project = Path.Combine(root, "image-project");
        string documents = Path.Combine(project, "docs", "chapter");
        string images = Path.Combine(project, "images");
        Directory.CreateDirectory(documents); Directory.CreateDirectory(images);
        string document = Path.Combine(documents, "reference.md");
        File.WriteAllText(document, "# Images");
        string name = "P02 #100% \u4e2d.svg";
        string image = Path.Combine(images, name);
        File.WriteAllText(image, "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"80\" height=\"40\"><rect width=\"80\" height=\"40\" fill=\"green\"/></svg>");
        var store = new FileStore(Path.Combine(root, "relative-image-profile"));
        store.Open(document);
        string reference = "../../images/" + Uri.EscapeDataString(name);
        var result = (Dictionary<string, object>)store.Json.DeserializeObject(store.Json.Serialize(store.ReadImage(reference)));
        Assert((string)result["mime"] == "image/svg+xml" && Convert.FromBase64String((string)result["data"]).Length == File.ReadAllBytes(image).Length, "parent SVG images render automatically without an authorization step");
        Assert(store.ResolveImagePath(reference) == image, "relative image references resolve against the Markdown directory");
        Assert(store.ResolveImagePath(image) == image && store.ResolveImagePath(new Uri(image).AbsoluteUri) == image, "absolute local and file URI images resolve without directory grants");
        Assert(store.ResolveImagePath("../../../outside.png") == Path.Combine(root, "outside.png"), "local image reads may reference other local directories");
        var other = new FileStore(Path.Combine(root, "other-image-profile")); other.Open(document);
        Assert(other.ReadImage(reference) != null, "reopening a document does not require image authorization");
        bool blocked = false;
        try { store.ReadImage("https://example.invalid/image.png"); } catch (IOException) { blocked = true; }
        Assert(blocked, "automatic local access does not enable background network downloads");
        blocked = false;
        try { store.ReadImage(document); } catch (IOException) { blocked = true; }
        Assert(blocked, "image loading does not expose non-image files");
        string sibling = Path.Combine(project, "docs", "other"); Directory.CreateDirectory(sibling);
        string copied = Path.Combine(sibling, "copy.md");
        store.Save(copied, "# Images", new Dictionary<string, object>(), new[] { reference });
        Assert(File.Exists(copied) && store.ResolveImagePath(reference) == image, "save as preserves parent references when they still resolve to the same image");
        blocked = false;
        string distant = Path.Combine(root, "other-project", "docs", "copy.md");
        try { store.Save(distant, "Wrong", new Dictionary<string, object>(), new[] { reference }); } catch (IOException) { blocked = true; }
        Assert(blocked && !File.Exists(distant), "automatic image reads do not permit writes outside the chosen save destination");
        blocked = false;
        try { store.Save(copied, new string('x', 24 * 1024 * 1024) + "\n", new Dictionary<string, object>(), new string[0]); } catch (IOException) { blocked = true; }
        Assert(blocked && File.ReadAllText(copied) == "# Images", "oversized saved Markdown is rejected before overwriting the previous document");
        store.New();
        Assert(File.ReadAllText(document) == "# Images", "reading relative images does not rewrite the Markdown document");
    }
    public static int Main() {
        string root = Path.Combine(Path.GetTempPath(), "Inklet-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try {
            VerifyWorkspace(root);
            VerifyWindowOwnership(root);
            VerifyRelativeImageAccess(root);
            var store = new FileStore(Path.Combine(root, "profile"));
            string document = Path.Combine(root, "notes.md");
            File.WriteAllText(document, "# Title\r\n\r\nOriginal\r\n", new UTF8Encoding(true));
            store.Open(document);
            store.Save(document, "# Title\n\nUpdated\n", new Dictionary<string, object> { { "marks", new object[0] } }, new string[0]);
            Assert(File.ReadAllText(document).Contains("\r\n"), "preserves CRLF");
            Assert(File.ReadAllBytes(document)[0] == 239, "preserves UTF-8 BOM");
            Assert(File.ReadAllText(Path.Combine(root, ".inklet-backups", "notes.md.bak")).Contains("Original"), "retains previous source backup");
            Assert(File.Exists(document + ".inklet.json"), "annotation sidecar saved");
            File.WriteAllText(document, "External edit");
            bool conflict = false;
            try { store.Save(document, "Wrong", new Dictionary<string, object>(), new string[0]); } catch (IOException) { conflict = true; }
            Assert(conflict && File.ReadAllText(document) == "External edit", "external edits are not overwritten");
            string originalStamp = store.CurrentStamp;
            var external = store.Json.Deserialize<Dictionary<string, object>>(store.Json.Serialize(store.ReadExternal(document)));
            Assert((string)external["text"] == "External edit", "reads external document without saving it");
            Assert(store.CurrentStamp == originalStamp, "external preview does not advance the save baseline");
            Assert(!store.AcceptExternal(document, "wrong-stamp"), "rejects an unrecognized external snapshot");
            store.SaveRecovery(new Dictionary<string, object> { { "text", "discarded local draft" } });
            Assert(store.AcceptExternal(document, (string)external["stamp"]), "adopts only the external snapshot displayed by the editor");
            Assert(store.Recovery() == null, "accepting disk contents clears the discarded recovery draft");
            Assert(store.CurrentStamp == store.Stamp(document) && !store.HasBom, "accepted snapshot updates stamp and file encoding metadata");
            Assert(store.ReadExternal(document) == null, "unchanged disk content produces no reload");
            File.WriteAllText(document, "External second edit");
            external = store.Json.Deserialize<Dictionary<string, object>>(store.Json.Serialize(store.ReadExternal(document)));
            File.WriteAllText(document, "External third edit");
            Assert(store.AcceptExternal(document, (string)external["stamp"]), "can acknowledge a displayed snapshot while disk changes again");
            bool racingConflict = false;
            try { store.Save(document, "Do not overwrite third edit", new Dictionary<string, object>(), new string[0]); } catch (IOException) { racingConflict = true; }
            Assert(racingConflict && File.ReadAllText(document) == "External third edit", "a newer disk write remains protected after snapshot acknowledgement");
            Assert(store.ReadExternal(Path.Combine(root, "other.md")) == null, "external reads cannot switch the current document");
            bool blocked = false;
            try { FileStore.ResolveAsset(root, "../escape.png"); } catch (IOException) { blocked = true; }
            Assert(blocked, "blocks asset path traversal");
            store.New();
            byte[] image = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==");
            var imported = store.Json.Deserialize<Dictionary<string, object>>(store.Json.Serialize(store.ImportImage(Convert.ToBase64String(image), "image/png")));
            string relative = (string)imported["path"];
            Assert(File.Exists(FileStore.ResolveAsset(store.SourceDirectory, relative)), "draft image stored locally");
            string destination = Path.Combine(root, "new-folder", "saved.md");
            store.Save(destination, "![picture](" + relative + ")", new Dictionary<string, object>(), new[] { relative });
            Assert(File.Exists(FileStore.ResolveAsset(Path.GetDirectoryName(destination), relative)), "first save migrates draft image");
            string imageName = "\u6D41\u7A0B \u793A\u610F 100%.png";
            File.WriteAllBytes(Path.Combine(store.SourceDirectory, imageName), image);
            var exportedImage = store.Json.Deserialize<Dictionary<string, object>>(store.Json.Serialize(store.ReadImage(Uri.EscapeDataString(imageName))));
            Assert((string)exportedImage["data"] == Convert.ToBase64String(image), "exports a real image with encoded Chinese spaces and percent signs");
            Assert((string)exportedImage["mime"] == "image/png", "export image retains its actual MIME type");
            string missingImageName = "\u5360\u4F4D\uFF1AMD\u8F6CWord\u65F6\u7531\u6A21\u677F\u5C01\u9762\u5E26\u5165";
            string missingImageMessage = "";
            try { store.ReadImage(Uri.EscapeDataString(missingImageName)); } catch (IOException error) { missingImageMessage = error.Message; }
            Assert(missingImageMessage.Contains(missingImageName) && !missingImageMessage.Contains("%E"), "missing image errors show a readable original path");
            bool exportBlocked = false;
            try { store.ReadImage("%2e%2e/escape.png"); } catch (IOException) { exportBlocked = true; }
            Assert(exportBlocked, "image export still blocks encoded directory traversal");
            store.SaveRecovery(new Dictionary<string, object> { { "text", "unsaved" } });
            Assert(store.Recovery() != null, "recovery survives serialization");
            store.SaveRecovery(new Dictionary<string, object> { { "text", "newer draft" } });
            File.WriteAllText(Path.Combine(store.DataDirectory, "recovery.json"), "{truncated");
            var recovered = (Dictionary<string, object>)new FileStore(store.DataDirectory).Recovery();
            Assert((string)recovered["text"] == "unsaved", "corrupt latest snapshot falls back to the previous durable copy");
            Assert((bool)recovered["recoveredPreviousSnapshot"], "fallback recovery is explicitly identified");
            store.ClearRecovery();
            Assert(store.Recovery() == null, "saved recovery is cleared");
            Assert(!File.Exists(Path.Combine(store.DataDirectory, ".inklet-backups", "recovery.json.bak")), "discard removes the fallback copy too");
            store.SaveRecovery(new Dictionary<string, object> { { "text", "start" }, { "documentId", "journal-test" }, { "revision", 1 } });
            store.AppendRecovery(new Dictionary<string, object> {
                { "documentId", "journal-test" }, { "baseRevision", 1 }, { "revision", 2 },
                { "change", new Dictionary<string, object> { { "from", 5 }, { "to", 5 }, { "insert", " durable" } } }
            });
            File.AppendAllText(Path.Combine(store.DataDirectory, "recovery.jsonl"), "{torn", Encoding.UTF8);
            recovered = (Dictionary<string, object>)new FileStore(store.DataDirectory).Recovery();
            Assert((string)recovered["text"] == "start durable", "journal replays acknowledged input after process restart");
            Assert((bool)recovered["recoveredPartialJournal"], "torn journal tail retains the last valid state");
            var wrongBase = store.Json.Deserialize<Dictionary<string, object>>(store.Json.Serialize(store.AppendRecovery(new Dictionary<string, object> {
                { "documentId", "other-document" }, { "baseRevision", 1 }, { "revision", 2 },
                { "change", new Dictionary<string, object> { { "from", 0 }, { "to", 0 }, { "insert", "wrong" } } }
            })));
            Assert((bool)wrongBase["needsSnapshot"], "stale or foreign document deltas require a new snapshot");
            store.ClearRecovery();
            string registryPath = @"Software\Inklet\Tests\" + Guid.NewGuid().ToString("N");
            try {
                using (var sandbox = Registry.CurrentUser.CreateSubKey(registryPath)) {
                    using (var previous = sandbox.CreateSubKey(@"Software\Classes\.md")) previous.SetValue("", "Existing.Markdown");
                    string executable = Path.Combine(root, "Inklet.exe");
                    File.Copy(System.Reflection.Assembly.GetExecutingAssembly().Location, executable);
                    File.WriteAllBytes(Path.Combine(root, ShellIntegration.DocumentIconName), image);
                    ShellIntegration.Register(sandbox, executable);
                    using (var association = sandbox.OpenSubKey(@"Software\Classes\Inklet.Markdown\shell\open\command")) {
                        Assert((string)association.GetValue("") == "\"" + executable + "\" \"%1\"", "association quotes executable and document path");
                    }
                    using (var previous = sandbox.OpenSubKey(@"Software\Classes\.md")) Assert((string)previous.GetValue("") == "Existing.Markdown", "registration preserves existing default application");
                    using (var userChoice = sandbox.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice")) Assert(userChoice == null, "registration does not write protected UserChoice");
                    using (var capability = sandbox.OpenSubKey(@"Software\Inklet\Capabilities\FileAssociations")) Assert((string)capability.GetValue(".md") == ShellIntegration.ProgId, "Markdown capability points to registered ProgID");
                    using (var documentIcon = sandbox.OpenSubKey(@"Software\Classes\Inklet.Markdown\DefaultIcon")) Assert((string)documentIcon.GetValue("") == "\"" + Path.Combine(root, "Markdown.ico") + "\",0", "Markdown files use their own document icon");
                    using (var application = sandbox.OpenSubKey(@"Software\Inklet\Capabilities")) Assert((string)application.GetValue("ApplicationIcon") == "\"" + executable + "\",0", "the application keeps its original logo icon");
                    Assert(!ShellIntegration.RefreshRegistration(sandbox, executable), "correct registration does not rewrite itself on every launch");
                    using (var old = sandbox.CreateSubKey(@"Software\Classes\Inklet.Markdown\shell\open\command")) old.SetValue("", "\"" + Path.Combine(root, "missing-old", "Inklet.exe") + "\" \"%1\"");
                    Assert(ShellIntegration.RefreshRegistration(sandbox, executable), "a relocated or removed old version is replaced by the launched version");
                    using (var association = sandbox.OpenSubKey(@"Software\Classes\Inklet.Markdown\shell\open\command")) Assert((string)association.GetValue("") == "\"" + executable + "\" \"%1\"", "registration repair targets the launched executable");
                    Assert(ShellIntegration.CanUpgradeRegistration("0.5.0.0", "0.6.1.0") && !ShellIntegration.CanUpgradeRegistration("0.6.1.0", "0.5.0.0"), "older versions cannot downgrade an existing association");
                    Assert(ShellIntegration.CanForwardVersion("0.6.1.0", "0.6.1.0") && !ShellIntegration.CanForwardVersion("0.5.0.0", "0.6.1.0"), "file forwarding requires the same application version");
                    using (var fresh = sandbox.CreateSubKey("Unregistered")) Assert(!ShellIntegration.RefreshRegistration(fresh, executable), "startup repair does not claim file types that were never registered");
                }
            } finally { Registry.CurrentUser.DeleteSubKeyTree(registryPath, false); }
            string resourceFile = Path.Combine(root, "Inklet.resources");
            using (var archive = ZipFile.Open(resourceFile, ZipArchiveMode.Create)) {
                using (var writer = new StreamWriter(archive.CreateEntry("index.html").Open())) writer.Write("<h1>Inklet</h1>");
                using (var writer = new StreamWriter(archive.CreateEntry("assets\\worker.js").Open())) writer.Write("self.onmessage = () => {};");
            }
            using (var resources = new ResourcePack(resourceFile)) {
                string mime;
                using (var content = resources.Open("index.html", out mime)) {
                    Assert(mime.StartsWith("text/html"), "packed HTML retains its content type");
                    using (var reader = new StreamReader(content)) Assert(reader.ReadToEnd() == "<h1>Inklet</h1>", "packed resource bytes are decompressed without disk extraction");
                }
                using (var content = resources.Open("assets/worker.js", out mime)) Assert(content != null && mime.StartsWith("text/javascript"), "packed workers are available with script MIME type");
                Assert(resources.Open("../notes.md", out mime) == null && resources.Open("assets\\worker.js", out mime) == null, "packed resource lookup rejects path traversal");
                Assert(resources.Open("missing.js", out mime) == null, "missing packed resources are not substituted silently");
            }
            var historyStore = new FileStore(Path.Combine(root, "history-profile"));
            string historyFile = Path.Combine(root, "History with spaces.md");
            File.WriteAllText(historyFile, "# Original history file", new UTF8Encoding(false));
            historyStore.Open(historyFile);
            var historyEntries = new OpenHistory(historyStore.DataDirectory).Read();
            Assert(historyEntries.Count == 1 && historyEntries[0].Path == historyFile, "successful Markdown opens persist original paths");
            DateTimeOffset openedAt;
            Assert(DateTimeOffset.TryParse(historyEntries[0].OpenedAt, out openedAt), "history records include a valid timestamp");
            historyStore.Open(historyStore.History.Resolve(historyEntries[0].Id));
            Assert(historyStore.History.Read().Count == 2, "reopening from history records a new visit");
            File.Move(historyFile, historyFile + ".moved");
            bool missingHistory = false;
            try { historyStore.History.Resolve(historyEntries[0].Id); } catch (FileNotFoundException error) { missingHistory = error.Message.StartsWith("原地址无该文件。"); }
            Assert(missingHistory && historyStore.History.Read().Count == 2, "moved history files report their original location without deleting history");
            Assert(historyStore.CurrentPath == historyFile, "failed history lookup does not switch the current document");
            File.WriteAllText(Path.Combine(historyStore.DataDirectory, "open-history.json"), "{broken");
            Assert(historyStore.History.Read().Count == 1, "history can fall back to its previous valid copy");
            var historySeed = new List<OpenHistoryEntry>();
            for (int index = 0; index <= OpenHistory.MaximumEntries; index++) historySeed.Add(new OpenHistoryEntry { Id = "entry-" + index, Path = historyFile, Name = "History with spaces.md", OpenedAt = DateTimeOffset.UtcNow.ToString("O") });
            File.WriteAllText(Path.Combine(historyStore.DataDirectory, "open-history.json"), historyStore.Json.Serialize(historySeed));
            File.Move(historyFile + ".moved", historyFile);
            historyStore.Open(historyFile);
            historyEntries = historyStore.History.Read();
            Assert(historyEntries.Count == OpenHistory.MaximumEntries && !historyEntries[0].Id.StartsWith("entry-"), "history retains the newest 200 visits after another successful open");
            string invalidHistoryFile = Path.Combine(root, "Invalid history.md");
            File.WriteAllBytes(invalidHistoryFile, new byte[] { 255, 254, 0 });
            bool rejectedHistoryFile = false;
            try { historyStore.Open(invalidHistoryFile); } catch (IOException) { rejectedHistoryFile = true; }
            Assert(rejectedHistoryFile && historyStore.CurrentPath == historyFile && historyStore.History.Read()[0].Id == historyEntries[0].Id, "failed document opens neither record a visit nor switch the document");
            var emptyHistoryStore = new FileStore(Path.Combine(root, "corrupt-history-profile"));
            File.WriteAllText(Path.Combine(emptyHistoryStore.DataDirectory, "open-history.json"), "not json");
            Assert(emptyHistoryStore.History.Read().Count == 0, "corrupt history without a backup does not prevent startup");
            var readingProfile = new FileStore(Path.Combine(root, "reading-profile"));
            var readingHistory = new ReadingHistory(readingProfile.DataDirectory);
            var firstReading = new ReadingPosition { Path = historyFile, Hash = FileStore.TextHash("original"), SourcePosition = 120, Heading = "Chapter", HeadingLevel = 2, HeadingOccurrence = 0, BlockProgress = 0.4, ActivePane = "rich", FallbackScrollTop = 500 };
            Assert(readingHistory.Read(historyFile) == null, "new documents have no reading position");
            readingHistory.Record(firstReading);
            Assert(readingHistory.Read(historyFile.ToUpperInvariant()).SourcePosition == 120, "reading positions use case-insensitive full Windows paths");
            var secondReading = new ReadingPosition { Path = invalidHistoryFile, SourcePosition = 30, Heading = "Other", HeadingLevel = 1, BlockProgress = 0, ActivePane = "source", FallbackScrollTop = 10 };
            readingHistory.Record(secondReading);
            firstReading.SourcePosition = 240; readingHistory.Record(firstReading);
            Assert(new ReadingHistory(readingProfile.DataDirectory).Read(historyFile).SourcePosition == 240 && readingHistory.Read(invalidHistoryFile).SourcePosition == 30, "reading history persists independent latest positions per file");
            Assert(readingProfile.Json.Deserialize<List<ReadingPosition>>(File.ReadAllText(Path.Combine(readingProfile.DataDirectory, "reading-positions.json"))).Count == 2, "reading visits update an existing record rather than append duplicate paths");
            bool invalidReading = false;
            try { readingHistory.Record(new ReadingPosition { Path = historyFile, SourcePosition = -1, ActivePane = "rich" }); } catch (ArgumentException) { invalidReading = true; }
            Assert(invalidReading && readingHistory.Read(historyFile).SourcePosition == 240, "invalid reading metadata cannot overwrite a valid position");
            File.WriteAllText(Path.Combine(readingProfile.DataDirectory, "reading-positions.json"), "{broken");
            Assert(readingHistory.Read(historyFile).SourcePosition == 120, "reading history recovers its preceding atomic backup");
            Assert(readingHistory.Read(Path.Combine(root, "different", Path.GetFileName(historyFile))) == null, "same filename in another folder does not inherit reading state");
            var sessionStore = new FileStore(Path.Combine(root, "session-profile"));
            Assert(sessionStore.ReadLastDocumentPath() == null, "first launch has no remembered document");
            sessionStore.Open(historyFile);
            Assert(sessionStore.ReadLastDocumentPath() == historyFile, "upgrades can fall back to their existing open history");
            sessionStore.RememberLastDocument();
            Assert(new FileStore(sessionStore.DataDirectory).ReadLastDocumentPath() == historyFile, "last closed file survives a new store instance");
            string savedAsPath = Path.Combine(root, "Session saved as.md");
            sessionStore.Save(savedAsPath, "# Saved as", new Dictionary<string, object>(), new string[0]);
            Assert(sessionStore.ReadLastDocumentPath() == historyFile, "changing documents alone does not overwrite the last closed state");
            sessionStore.RememberLastDocument();
            Assert(new FileStore(sessionStore.DataDirectory).ReadLastDocumentPath() == savedAsPath, "closing after save-as remembers the new file path");
            File.Move(savedAsPath, savedAsPath + ".moved");
            Assert(sessionStore.ReadLastDocumentPath() == savedAsPath, "missing last documents retain their original path for a startup warning");
            sessionStore.New(); sessionStore.RememberLastDocument();
            Assert(new FileStore(sessionStore.DataDirectory).ReadLastDocumentPath() == null, "closing an empty document does not reopen an older history entry");
            File.WriteAllText(Path.Combine(sessionStore.DataDirectory, "last-document.json"), "{broken");
            Assert(sessionStore.ReadLastDocumentPath() == null, "corrupt last-document metadata does not prevent startup");
            string diagnosticsDirectory = Path.Combine(root, "diagnostic-profile");
            var diagnostics = new RuntimeDiagnostics(diagnosticsDirectory);
            var diagnostic = new RuntimeDiagnostic { AppVersion = "test", WebViewVersion = "test-runtime", Kind = "RenderProcessExited", Reason = "Crashed", ExitCode = unchecked((int)0x80000003), Dirty = true, DocumentLength = 4000, SearchActive = true, QueryLength = 5, MatchCount = 20 };
            diagnostics.Append(diagnostic);
            var diagnosticData = historyStore.Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(diagnostics.LogPath));
            Assert((string)diagnosticData["ExitCodeHex"] == "0x80000003", "diagnostic logs preserve signed native exit codes as hexadecimal");
            Assert(diagnosticData.ContainsKey("TimeUtc") && diagnosticData.ContainsKey("WebViewVersion") && diagnosticData.ContainsKey("QueryLength"), "diagnostic records contain timestamp, runtime and numeric search context");
            Assert(!diagnosticData.ContainsKey("Text") && !diagnosticData.ContainsKey("Path") && !diagnosticData.ContainsKey("Query"), "diagnostic schema excludes document text, paths and search terms");
            File.WriteAllText(diagnostics.LogPath, new string('x', RuntimeDiagnostics.MaximumBytes));
            diagnostics.Append(diagnostic);
            Assert(new FileInfo(diagnostics.LogPath).Length < RuntimeDiagnostics.MaximumBytes && File.Exists(diagnostics.LogPath + ".previous"), "diagnostic logs rotate at the configured size limit");
            Console.WriteLine("INKLET_FILE_TESTS_OK " + checks);
            return 0;
        } catch (Exception error) {
            Console.Error.WriteLine(error);
            return 1;
        } finally { Directory.Delete(root, true); }
    }
}
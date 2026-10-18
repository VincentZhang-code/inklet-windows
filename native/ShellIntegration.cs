using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace Inklet {
    public static class ShellIntegration {
        public const string ApplicationName = "Inklet 墨点";
        public const string ProgId = "Inklet.Markdown";
        public const string DocumentIconName = "Markdown.ico";
        public const int CopyDataMessage = 0x004A;
        public static readonly IntPtr MessageTag = new IntPtr(0x494E4B);

        [StructLayout(LayoutKind.Sequential)]
        public struct CopyData {
            public IntPtr Tag;
            public int Length;
            public IntPtr Data;
        }
        private delegate bool EnumerateWindow(IntPtr window, IntPtr argument);
        [DllImport("user32.dll")] private static extern bool EnumWindows(EnumerateWindow callback, IntPtr argument);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetProp(IntPtr window, string name);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool SetProp(IntPtr window, string name, IntPtr value);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr RemoveProp(IntPtr window, string name);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr sender, ref CopyData data, uint flags, uint timeout, out IntPtr result);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
        [DllImport("user32.dll")] private static extern bool AllowSetForegroundWindow(uint processId);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("shell32.dll")] private static extern void SHChangeNotify(uint eventId, uint flags, IntPtr first, IntPtr second);

        public static string Identity(string profile) { return "Inklet-" + FileStore.TextHash(Path.GetFullPath(profile)).Substring(0, 16); }

        public static bool CanForwardVersion(string running, string requested) {
            Version first, second;
            return Version.TryParse(running, out first) && Version.TryParse(requested, out second) && first == second;
        }

        public static bool CanUpgradeRegistration(string previous, string current) {
            Version first, second;
            return Version.TryParse(current, out second) && (!Version.TryParse(previous, out first) || second >= first);
        }

        public static bool RefreshRegistration(RegistryKey userRoot, string executable) {
            string previous;
            using (var key = userRoot.OpenSubKey(@"Software\Classes\" + ProgId + @"\shell\open\command")) {
                if (key == null) return false;
                previous = key.GetValue("") as string;
            }
            if (String.IsNullOrEmpty(previous) || previous[0] != '"') return false;
            int end = previous.IndexOf('"', 1);
            if (end < 2) return false;
            string oldPath = previous.Substring(1, end - 1);
            string oldVersion = File.Exists(oldPath) ? FileVersionInfo.GetVersionInfo(oldPath).FileVersion : null;
            executable = Path.GetFullPath(executable);
            if (!CanUpgradeRegistration(oldVersion, FileVersionInfo.GetVersionInfo(executable).FileVersion)) return false;
            string expectedIcon = "\"" + Path.Combine(Path.GetDirectoryName(executable), DocumentIconName) + "\",0";
            using (var key = userRoot.OpenSubKey(@"Software\Classes\" + ProgId + @"\DefaultIcon")) {
                if (String.Equals(oldPath, executable, StringComparison.OrdinalIgnoreCase) && key != null && String.Equals(key.GetValue("") as string, expectedIcon, StringComparison.OrdinalIgnoreCase)) return false;
            }
            Register(userRoot, executable);
            return true;
        }

        public static bool ForwardOpen(string identity, string path) {
            IntPtr target = IntPtr.Zero;
            EnumWindows((window, argument) => {
                if (GetProp(window, identity) == IntPtr.Zero) return true;
                target = window;
                return false;
            }, IntPtr.Zero);
            if (target == IntPtr.Zero) return false;
            uint processId;
            GetWindowThreadProcessId(target, out processId);
                        try {
                                using (var process = Process.GetProcessById((int)processId)) {
                                        if (!CanForwardVersion(process.MainModule.FileVersionInfo.FileVersion, FileVersionInfo.GetVersionInfo(System.Reflection.Assembly.GetExecutingAssembly().Location).FileVersion)) return false;
                                }
                        } catch (System.ComponentModel.Win32Exception) { return false; }
                            catch (InvalidOperationException) { return false; }
                            catch (ArgumentException) { return false; }
            AllowSetForegroundWindow(processId);
            string text = path ?? "";
            if (text.Length > 32000) return false;
            IntPtr pointer = Marshal.StringToHGlobalUni(text);
            try {
                var data = new CopyData { Tag = MessageTag, Length = (text.Length + 1) * 2, Data = pointer };
                IntPtr result;
                return SendMessageTimeout(target, CopyDataMessage, IntPtr.Zero, ref data, 0x0002, 3000, out result) != IntPtr.Zero && result == new IntPtr(1);
            } finally { Marshal.FreeHGlobal(pointer); }
        }

        public static void Register(RegistryKey userRoot, string executable) {
            executable = Path.GetFullPath(executable);
            if (!File.Exists(executable)) throw new FileNotFoundException("找不到 Inklet 程序，请先解压完整便携包。", executable);
            string documentIcon = Path.Combine(Path.GetDirectoryName(executable), DocumentIconName);
            if (!File.Exists(documentIcon)) throw new FileNotFoundException("Markdown 文档图标缺失，请先解压完整便携包。", documentIcon);
            string command = "\"" + executable + "\" \"%1\"";
            string icon = "\"" + executable + "\",0";
            using (var key = userRoot.CreateSubKey(@"Software\Classes\" + ProgId)) {
                key.SetValue("", "Markdown 文档");
                key.SetValue("FriendlyTypeName", "Markdown 文档");
                using (var child = key.CreateSubKey("DefaultIcon")) child.SetValue("", "\"" + documentIcon + "\",0");
                using (var child = key.CreateSubKey(@"shell\open\command")) child.SetValue("", command);
            }
            using (var key = userRoot.CreateSubKey(@"Software\Classes\Applications\Inklet.exe")) {
                key.SetValue("FriendlyAppName", ApplicationName);
                using (var child = key.CreateSubKey(@"shell\open\command")) child.SetValue("", command);
                using (var child = key.CreateSubKey("SupportedTypes")) {
                    child.SetValue(".md", "");
                    child.SetValue(".markdown", "");
                }
            }
            using (var key = userRoot.CreateSubKey(@"Software\Inklet\Capabilities")) {
                key.SetValue("ApplicationName", ApplicationName);
                key.SetValue("ApplicationDescription", "本地 Markdown 编辑与阅读");
                key.SetValue("ApplicationIcon", icon);
                using (var child = key.CreateSubKey("FileAssociations")) {
                    child.SetValue(".md", ProgId);
                    child.SetValue(".markdown", ProgId);
                }
            }
            using (var key = userRoot.CreateSubKey(@"Software\RegisteredApplications")) key.SetValue(ApplicationName, @"Software\Inklet\Capabilities");
            foreach (string extension in new[] { ".md", ".markdown" }) {
                using (var key = userRoot.CreateSubKey(@"Software\Classes\" + extension + @"\OpenWithProgids")) key.SetValue(ProgId, new byte[0], RegistryValueKind.None);
            }
        }

        public static void NotifyAssociationChange() { SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero); }
        public static string DefaultAppsUri { get { return "ms-settings:defaultapps?registeredAppUser=" + Uri.EscapeDataString(ApplicationName); } }
    }
}
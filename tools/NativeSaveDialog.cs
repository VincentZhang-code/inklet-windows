using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

public static class NativeSaveDialog {
    private delegate bool WindowCallback(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr window, WindowCallback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr parameter, string value);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, uint message, IntPtr first, IntPtr second);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetProp(IntPtr window, string name);
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int horizontal, int vertical);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(ScreenPoint point);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] private static extern void mouse_event(uint flags, uint horizontal, uint vertical, uint data, UIntPtr extra);
    [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out ScreenPoint point);
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [StructLayout(LayoutKind.Sequential)] private struct ScreenPoint { public int X, Y; }

    private static int Drag(uint processId, string value) {
        string[] parts = value.Split(',');
        int fromX, fromY, toX, toY;
        if ((parts.Length != 5 && parts.Length != 6) || !Int32.TryParse(parts[1], out fromX) || !Int32.TryParse(parts[2], out fromY) || !Int32.TryParse(parts[3], out toX) || !Int32.TryParse(parts[4], out toY)) return 2;
        bool cancel = parts.Length == 6 && parts[5] == "escape";
        IntPtr target = IntPtr.Zero;
        EnumWindows((window, data) => { uint owner; GetWindowThreadProcessId(window, out owner); if (owner == processId && GetProp(window, "InkletWindow-" + parts[0]) != IntPtr.Zero) target = window; return target == IntPtr.Zero; }, IntPtr.Zero);
        if (target == IntPtr.Zero) { Console.Error.WriteLine("DRAG_WINDOW_NOT_FOUND"); return 1; }
        ScreenPoint original; GetCursorPos(out original);
        bool focused = SetForegroundWindow(target);
        int step = 0, result = 1;
        using (var timer = new Timer { Interval = 35 }) {
            timer.Tick += (sender, args) => {
                if (step == 0) {
                    var start = new ScreenPoint { X = fromX, Y = fromY };
                    IntPtr hit = GetAncestor(WindowFromPoint(start), 2);
                    if (hit != target) { Console.Error.WriteLine("DRAG_HIT_TEST_BLOCKED target=" + target + " hit=" + hit + " focusAccepted=" + focused); timer.Stop(); Application.ExitThread(); return; }
                    SetCursorPos(fromX, fromY); mouse_event(2, 0, 0, 0, UIntPtr.Zero);
                } else if (step <= 16) {
                    SetCursorPos(fromX + (toX - fromX) * step / 16, fromY + (toY - fromY) * step / 16);
                    if (cancel && step == 16) { keybd_event(27, 0, 0, UIntPtr.Zero); keybd_event(27, 0, 2, UIntPtr.Zero); }
                }
                else if (step == 17) mouse_event(4, 0, 0, 0, UIntPtr.Zero);
                else if (step == 23) { SetCursorPos(original.X, original.Y); timer.Stop(); result = 0; Application.ExitThread(); }
                step++;
            };
            timer.Start(); Application.Run();
        }
        return result;
    }

    [STAThread]
    public static int Main(string[] args) {
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
        if (args.Length != 2) return 2;
        uint processId;
        if (!UInt32.TryParse(args[0], out processId)) return 2;
        if (args[1].StartsWith("--find-shortcut=", StringComparison.Ordinal)) {
            string windowId = args[1].Substring(16);
            Guid parsed;
            if (!Guid.TryParseExact(windowId, "N", out parsed)) return 2;
            IntPtr target = IntPtr.Zero;
            EnumWindows((window, data) => { uint owner; GetWindowThreadProcessId(window, out owner); if (owner == processId && IsWindowVisible(window) && GetProp(window, "InkletWindow-" + windowId) != IntPtr.Zero) target = window; return target == IntPtr.Zero; }, IntPtr.Zero);
            if (target == IntPtr.Zero) { Console.Error.WriteLine("SHORTCUT_WINDOW_NOT_FOUND"); return 1; }
            SetForegroundWindow(target);
            if (GetForegroundWindow() != target) { Console.Error.WriteLine("SHORTCUT_FOCUS_BLOCKED"); return 1; }
            try {
                keybd_event(17, 0, 0, UIntPtr.Zero);
                keybd_event(70, 0, 0, UIntPtr.Zero);
            } finally {
                keybd_event(70, 0, 2, UIntPtr.Zero);
                keybd_event(17, 0, 2, UIntPtr.Zero);
            }
            Console.WriteLine("NATIVE_FIND_SHORTCUT_SENT");
            return 0;
        }
        if (args[1].StartsWith("--drag=", StringComparison.Ordinal)) return Drag(processId, args[1].Substring(7));
        if (args[1] == "--close" || args[1].StartsWith("--close-window=", StringComparison.Ordinal)) {
            string windowId = args[1] == "--close" ? null : args[1].Substring(15);
            bool requested = false;
            EnumWindows((window, data) => {
                uint owner;
                GetWindowThreadProcessId(window, out owner);
                if (owner != processId || !IsWindowVisible(window)) return true;
                if (windowId != null && GetProp(window, "InkletWindow-" + windowId) == IntPtr.Zero) return true;
                var className = new StringBuilder(256); GetClassName(window, className, 256);
                if (!className.ToString().StartsWith("WindowsForms10.Window", StringComparison.Ordinal)) return true;
                requested = PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero);
                return !requested;
            }, IntPtr.Zero);
            return requested ? 0 : 1;
        }
        int result = 1;
        bool acknowledge = args[1] == "--ack-message";
        bool folderSelection = args[1].StartsWith("--folder=", StringComparison.Ordinal);
        string observed = "No dialog controls observed.";
        var watch = Stopwatch.StartNew();
        using (var timer = new Timer { Interval = 100 }) {
            timer.Tick += (sender, eventArgs) => {
                if (watch.ElapsedMilliseconds > 25000) { Console.Error.WriteLine("Dialog not found for test process: " + observed); timer.Stop(); Application.ExitThread(); return; }
                IntPtr dialog = IntPtr.Zero;
                IntPtr input = IntPtr.Zero;
                IntPtr confirm = IntPtr.Zero;
                EnumWindows((window, data) => {
                    uint owner;
                    GetWindowThreadProcessId(window, out owner);
                    if (owner != processId || !IsWindowVisible(window)) return true;
                    var className = new StringBuilder(256); GetClassName(window, className, 256);
                    if (className.ToString() != "#32770") return true;
                    var controls = new StringBuilder();
                    EnumChildWindows(window, (child, unused) => {
                        var kind = new StringBuilder(256); GetClassName(child, kind, 256);
                        controls.Append(kind).Append(':').Append(GetDlgCtrlID(child)).Append(':').Append(IsWindowVisible(child)).Append(' ');
                        int control = GetDlgCtrlID(child);
                        bool filename = control == 1001 || control == 1152 || control == 1148 || GetDlgCtrlID(GetParent(child)) == 1148;
                        if (filename && kind.ToString() == "Edit" && IsWindowVisible(child)) input = child;
                        if ((control == 1 || (acknowledge && control == 2)) && kind.ToString() == "Button" && IsWindowVisible(child)) confirm = child;
                        return true;
                    }, IntPtr.Zero);
                    observed = controls.ToString();
                    if (confirm == IntPtr.Zero || (folderSelection && !observed.Contains("SysTreeView32")) || (!folderSelection && (acknowledge ? input != IntPtr.Zero : input == IntPtr.Zero))) return true;
                    dialog = window;
                    return false;
                }, IntPtr.Zero);
                if (dialog == IntPtr.Zero) return;
                timer.Stop();
                if (folderSelection) Console.Error.WriteLine("FOLDER_DIALOG_CONTROLS " + observed);
                if (!folderSelection && !acknowledge) SendMessage(input, 0x000C, IntPtr.Zero, args[1]);
                PostMessage(confirm, 0x00F5, IntPtr.Zero, IntPtr.Zero);
                Console.WriteLine(acknowledge ? "NATIVE_MESSAGE_ACKNOWLEDGED" : "NATIVE_SAVE_DIALOG_ACCEPTED");
                result = 0;
                Application.ExitThread();
            };
            timer.Start();
            Application.Run();
        }
        return result;
    }
}
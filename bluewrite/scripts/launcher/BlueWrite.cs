// BlueWrite — the launcher behind BlueWrite.exe.
//
// WHY AN EXE AT ALL, when Start BlueWrite.bat already does this. The .bat is the
// thing a developer runs; the executable is the thing the STATION runs. A desktop
// shortcut, a pinned taskbar button, a "run this on the officer's workstation"
// instruction and a Task Scheduler action all take an .exe and all of them treat a
// .bat at arm's length — Windows hands it a console that is closed the moment the
// double-click ends, which is exactly when the report it printed is worth reading.
//
// IT DOES NOT REIMPLEMENT STARTING. Everything about how this stack comes up —
// which port, which PHP, the correct Laragon MySQL, the hidden consoles, the
// one-repair-per-minute watchdog — lives in scripts\serve.cmd and
// scripts\watch-servers.ps1, and this file CALLS the first of those. A second copy
// of "how a server starts" is a second copy that can drift, and the symptom of
// drift is a port nobody is on; the launcher is a front door, not a second house.
//
// WHAT IT ADDS OVER THE .bat, and only this:
//
//   * the report is READ, not flashed past. A failure waits for a keypress;
//     the .bat's window closes under the officer before they can see why.
//   * `--no-open` and `--help`, so the launcher can be used by a script (a
//     shortcut can start the stack without stealing the browser) and can explain
//     itself without being run.
//   * a missing bluewrite\ folder is NAMED as such — "BlueWrite.exe must sit
//     beside the bluewrite folder" — instead of a cmd.exe message about a path.
//
// COMPILED BY scripts\launcher\build.cmd WITH THE .NET FRAMEWORK'S OWN csc.exe,
// which every Windows install already has: no SDK, no downloads, no runtime for
// the station to install. That compiler is C# 5, so this file stays inside it
// (no string interpolation, no expression-bodied members, no nameof).

using System;
using System.Diagnostics;
using System.IO;

internal static class BlueWriteLauncher
{
    /** The address an officer's browser is sent to. Patch notes: the dev server. */
    private const string Url = "http://localhost:5180";

    private static int Main(string[] args)
    {
        bool openBrowser = true;

        foreach (string arg in args)
        {
            if (string.Equals(arg, "--no-open", StringComparison.OrdinalIgnoreCase))
            {
                // The stack, and no browser: for a shortcut that runs at sign-in,
                // or for anyone checking that the servers come up.
                openBrowser = false;
            }
            else if (string.Equals(arg, "--help", StringComparison.OrdinalIgnoreCase)
                || string.Equals(arg, "-h", StringComparison.OrdinalIgnoreCase)
                || string.Equals(arg, "/?", StringComparison.OrdinalIgnoreCase))
            {
                PrintUsage();
                return 0;
            }
            else
            {
                Console.WriteLine("BlueWrite: unknown option \"" + arg + "\".");
                PrintUsage();
                return 2;
            }
        }

        // BESIDE THE bluewrite FOLDER, wherever this file was launched from. The
        // launcher is a door on a house, so it finds the house the way a person
        // would: from where it is standing, not from the current directory a
        // shortcut happened to hand it.
        string exeDir = AppDomain.CurrentDomain.BaseDirectory;
        string appDir = Path.Combine(exeDir, "bluewrite");
        string serve = Path.Combine(appDir, Path.Combine("scripts", "serve.cmd"));

        if (!File.Exists(serve))
        {
            Console.WriteLine("BlueWrite could not find the application.");
            Console.WriteLine("  looked for: " + serve);
            Console.WriteLine("BlueWrite.exe must sit beside the bluewrite folder, in the");
            Console.WriteLine("checkout it was built from. Move it back and try again.");
            Pause();
            return 1;
        }

        Console.WriteLine("BlueWrite — starting the station server.");
        Console.WriteLine();

        // THE ONE IMPLEMENTATION. serve.cmd reports each of the three ports
        // (the API on 8099, the dev server on 5180, MySQL on 3306) and hands the
        // starting of whatever is missing to the watchdog. Its output is left on
        // this console on purpose: "already up" versus "started" is the first
        // thing anybody helping with a failure needs to see.
        int code = Run("cmd.exe", "/c \"" + serve + "\"", appDir);

        if (code != 0)
        {
            Console.WriteLine();
            Console.WriteLine("BlueWrite could not bring the server up (exit code " + code.ToString() + ").");
            Console.WriteLine("Nothing was left half-started: run this file again once the cause above is fixed.");
            Pause();
            return code;
        }

        if (openBrowser)
        {
            if (!Open(Url))
            {
                // Not fatal — the app is up and reachable by hand.
                Console.WriteLine();
                Console.WriteLine("The browser could not be opened automatically. BlueWrite is running at:");
                Console.WriteLine("  " + Url);
                Pause();
            }
        }
        else
        {
            Console.WriteLine();
            Console.WriteLine("The server is up. BlueWrite is at " + Url);
        }

        return 0;
    }

    /** One child process, its output flowing to this console. */
    private static int Run(string file, string arguments, string workingDirectory)
    {
        ProcessStartInfo start = new ProcessStartInfo(file, arguments);
        start.WorkingDirectory = workingDirectory;
        start.UseShellExecute = false;

        using (Process child = Process.Start(start))
        {
            child.WaitForExit();
            return child.ExitCode;
        }
    }

    /** The default browser, handed the app's address. False when Windows says no. */
    private static bool Open(string url)
    {
        try
        {
            ProcessStartInfo start = new ProcessStartInfo(url);
            start.UseShellExecute = true;
            Process.Start(start);
            return true;
        }
        catch (Exception)
        {
            // No handler, no shell, or a locked-down machine: the caller prints
            // the address instead, which is all the officer needed anyway.
            return false;
        }
    }

    /**
     * Hold the window open so a double-click user can READ what went wrong.
     * Skipped when the input is redirected (a script, or a CI run): there is
     * nobody to press a key, and waiting for one would hang them.
     */
    private static void Pause()
    {
        if (Console.IsInputRedirected)
        {
            return;
        }
        Console.WriteLine();
        Console.Write("Press any key to close this window . . . ");
        try
        {
            Console.ReadKey(true);
        }
        catch (InvalidOperationException)
        {
            // No console to read from after all — nothing to pause for.
        }
    }

    private static void PrintUsage()
    {
        Console.WriteLine("BlueWrite — the station's incident-reporting system.");
        Console.WriteLine();
        Console.WriteLine("  BlueWrite.exe            start the server and open BlueWrite in the browser");
        Console.WriteLine("  BlueWrite.exe --no-open  start the server only");
        Console.WriteLine("  BlueWrite.exe --help     this text");
        Console.WriteLine();
        Console.WriteLine("Keep BlueWrite.exe beside the bluewrite folder; it starts exactly what");
        Console.WriteLine("Start BlueWrite.bat starts, through the same scripts.");
    }
}

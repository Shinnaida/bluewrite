// BlueWrite Setup — the installer behind BlueWrite-Setup.exe.
//
// WHAT THIS IS. BlueWrite.exe is a launcher: it must sit beside an already
// checked-out bluewrite/ folder with PHP, Node and MySQL already installed.
// BlueWrite-Setup.exe is the file a SECOND PC runs: double-click it and it
// brings everything the station needs, then opens the system in the browser.
//
// WHAT IT DOES, in order, and it explains each step as it goes:
//   1. Gets the app: if no bluewrite/ folder sits beside it, it downloads
//      https://github.com/Shinnaida/bluewrite/archive/refs/heads/main.zip
//      and extracts the bluewrite/ folder from it (via powershell
//      Expand-Archive, so no extra tools are needed).
//   2. Checks PHP, Node and MySQL. Whatever is missing it tries to install
//      with `winget` (Windows 10/11 already have it). If winget is absent or
//      an install fails, it prints the exact manual step instead of dying.
//   3. Creates bluewrite/config/config.php from config.sample.php when absent,
//      creates the `bluewrite` database and imports migrations 001-003.
//   4. Runs `npm install` + `npm run build` when node_modules or the built
//      bundle is missing, so public/ actually serves the app.
//   5. Starts the stack through scripts/serve.cmd (the ONE implementation —
//      same as BlueWrite.exe and Start BlueWrite.bat) and opens the browser.
//
// WHY NOT EMBED EVERYTHING. PHP + MySQL + Node are hundreds of megabytes;
// GitHub rejects any file over 100 MB, so no checked-in .exe can literally
// CONTAIN them. This setup is a downloader-installer instead: the .exe stays
// a few KB and fetches what the machine lacks on first run. The end result
// is the same for the officer: one file, double-click, system opens.
//
// COMPILED BY scripts/launcher/build.cmd WITH THE .NET FRAMEWORK'S OWN
// csc.exe (C# 5 only: no string interpolation, no expression-bodied members).

using System;
using System.Diagnostics;
using System.IO;
using System.Net;

internal static class BlueWriteSetup
{
    private const string RepoZip = "https://github.com/Shinnaida/bluewrite/archive/refs/heads/main.zip";
    private const string Url = "http://localhost:5180";
    private const string ApiUrl = "http://localhost:8099/";

    private static int Main(string[] args)
    {
        foreach (string arg in args)
        {
            if (string.Equals(arg, "--help", StringComparison.OrdinalIgnoreCase)
                || string.Equals(arg, "-h", StringComparison.OrdinalIgnoreCase)
                || string.Equals(arg, "/?", StringComparison.OrdinalIgnoreCase))
            {
                PrintUsage();
                return 0;
            }
        }

        Console.WriteLine("BlueWrite Setup — installing the station system.");
        Console.WriteLine();

        string exeDir = AppDomain.CurrentDomain.BaseDirectory;
        string appDir = Path.Combine(exeDir, "bluewrite");

        if (!Directory.Exists(appDir))
        {
            Console.WriteLine("[1/5] App folder not found beside this file — downloading from GitHub ...");
            if (!FetchApp(exeDir, appDir))
            {
                Pause();
                return 1;
            }
        }
        else
        {
            Console.WriteLine("[1/5] App folder found: " + appDir);
        }

        Console.WriteLine();
        Console.WriteLine("[2/5] Checking PHP, Node.js and MySQL ...");
        EnsureTool("php", "PHP.PHP.8.2", "PHP 8.2 (php.exe)");
        EnsureTool("node", "OpenJS.NodeJS.LTS", "Node.js LTS (node.exe)");
        EnsureTool("mysql", "Oracle.MySQL.8.0", "MySQL 8 (mysql.exe)");

        Console.WriteLine();
        Console.WriteLine("[3/5] Database + config ...");
        EnsureConfig(appDir);
        EnsureDatabase(appDir);

        Console.WriteLine();
        Console.WriteLine("[4/5] Frontend bundle ...");
        EnsureFrontend(appDir);

        Console.WriteLine();
        Console.WriteLine("[5/5] Starting the system ...");
        EnsureFirewall();
        string serve = Path.Combine(appDir, Path.Combine("scripts", "serve.cmd"));
        if (!File.Exists(serve))
        {
            Console.WriteLine("Setup could not find scripts/serve.cmd at:");
            Console.WriteLine("  " + serve);
            Pause();
            return 1;
        }
        int code = Run("cmd.exe", "/c \"" + serve + "\"", appDir);
        if (code != 0)
        {
            Console.WriteLine();
            Console.WriteLine("Setup could not bring the server up (exit code " + code + ").");
            Console.WriteLine("Fix the message above, then run BlueWrite-Setup.exe again.");
            Pause();
            return code;
        }

        Console.WriteLine();
        Console.WriteLine("BlueWrite is running:");
        Console.WriteLine("  App: " + Url);
        Console.WriteLine("  API (other PCs on the same Wi-Fi use http://<this-pc-ip>:8099/): " + ApiUrl);
        if (!Open(Url))
        {
            Console.WriteLine("The browser could not be opened automatically — open the address above by hand.");
        }
        else
        {
            Console.WriteLine("Opening the system in your browser ...");
        }
        Console.WriteLine();
        Console.WriteLine("Keep BlueWrite.exe beside the bluewrite folder for daily use.");
        Pause();
        return 0;
    }

    private static bool FetchApp(string exeDir, string appDir)
    {
        string tempZip = Path.Combine(Path.GetTempPath(), "bluewrite-main.zip");
        string tempDir = Path.Combine(Path.GetTempPath(), "bluewrite-main-extract");
        try
        {
            Console.WriteLine("  downloading " + RepoZip);
            using (WebClient client = new WebClient())
            {
                client.DownloadFile(RepoZip, tempZip);
            }
            if (Directory.Exists(tempDir))
            {
                Directory.Delete(tempDir, true);
            }
            Directory.CreateDirectory(tempDir);
            Console.WriteLine("  extracting ...");
            // Expand-Archive ships with Windows PowerShell 5+, no extra tools.
            int code = Run("powershell.exe", "-NoProfile -NonInteractive -Command \"Expand-Archive -Force '" + tempZip + "' '" + tempDir + "'\"", exeDir);
            if (code != 0)
            {
                Console.WriteLine("  Could not unzip the download. Check that PowerShell 5+ is installed,");
                Console.WriteLine("  then run this setup again. The zip is kept at " + tempZip);
                return false;
            }
            string[] inner = Directory.GetDirectories(tempDir);
            if (inner.Length == 0)
            {
                Console.WriteLine("  The download unzipped to nothing. Run setup again.");
                return false;
            }
            string src = Path.Combine(inner[0], "bluewrite");
            if (!Directory.Exists(src))
            {
                Console.WriteLine("  The download has no bluewrite/ folder. Run setup again.");
                return false;
            }
            Console.WriteLine("  copying app into " + appDir);
            CopyDir(src, appDir);
            Console.WriteLine("  App downloaded.");
            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine("  Download failed: " + ex.Message);
            Console.WriteLine("  Connect this PC to the internet and run setup again, or copy");
            Console.WriteLine("  the bluewrite/ folder beside BlueWrite-Setup.exe by hand (USB).");
            return false;
        }
        finally
        {
            try { if (File.Exists(tempZip)) File.Delete(tempZip); } catch { }
            try { if (Directory.Exists(tempDir)) Directory.Delete(tempDir, true); } catch { }
        }
    }

    private static void EnsureTool(string command, string wingetId, string label)
    {
        if (OnPath(command))
        {
            Console.WriteLine("  " + label + ": found.");
            return;
        }
        Console.WriteLine("  " + label + ": MISSING — installing with winget ...");
        int code = Run("winget.exe", "install -e --id " + wingetId + " --silent --accept-package-agreements --accept-source-agreements", AppDomain.CurrentDomain.BaseDirectory);
        if (code == 0 && OnPath(command))
        {
            Console.WriteLine("  " + label + ": installed.");
            return;
        }
        Console.WriteLine("  Could not auto-install " + label + ". Install it by hand, then re-run setup:");
        Console.WriteLine("    winget install -e --id " + wingetId);
        Console.WriteLine("  Continuing anyway — the servers will report what is still missing.");
    }

    private static void EnsureConfig(string appDir)
    {
        string sample = Path.Combine(appDir, Path.Combine("config", "config.sample.php"));
        string dest = Path.Combine(appDir, Path.Combine("config", "config.php"));
        if (File.Exists(dest))
        {
            Console.WriteLine("  config/config.php exists — leaving it.");
            return;
        }
        if (!File.Exists(sample))
        {
            Console.WriteLine("  config.sample.php not found — skipping config creation.");
            return;
        }
        try
        {
            File.Copy(sample, dest);
            Console.WriteLine("  Created config/config.php from the sample. Default DB user is root with");
            Console.WriteLine("  an empty password via Laragon; edit config.php if yours differs.");
        }
        catch (Exception ex)
        {
            Console.WriteLine("  Could not create config.php: " + ex.Message);
        }
    }

    private static void EnsureDatabase(string appDir)
    {
        if (!OnPath("mysql"))
        {
            Console.WriteLine("  mysql.exe not on PATH — skipping DB import. Install MySQL, then run");
            Console.WriteLine("  the Quick-start steps in README.md (CREATE DATABASE + migrations).");
            return;
        }
        // Root with empty password is Laragon's default; -p variants prompt, so
        // only the default is attempted here — anything else is a config.php edit.
        Run("mysql.exe", "-u root -e \"CREATE DATABASE IF NOT EXISTS bluewrite CHARACTER SET utf8mb4\"", appDir);
        string[] migs = new string[] { "001_schema.sql", "002_type_specific_fields.sql", "003_ai_assist.sql" };
        foreach (string mig in migs)
        {
            string path = Path.Combine(appDir, Path.Combine("migrations", mig));
            if (!File.Exists(path))
            {
                continue;
            }
            // cmd /c so the < redirect works.
            Run("cmd.exe", "/c mysql -u root bluewrite < \"" + path + "\"", appDir);
        }
        Console.WriteLine("  Database `bluewrite` ensured; migrations 001-003 applied (best effort).");
        Console.WriteLine("  If sign-in fails with access denied, fix config/config.php DB user/pass.");
    }

    private static void EnsureFrontend(string appDir)
    {
        string nodeModules = Path.Combine(appDir, "node_modules");
        string builtIndex = Path.Combine(appDir, Path.Combine("public", Path.Combine("assets", "")));
        bool hasBuild = Directory.Exists(builtIndex) && Directory.GetFiles(builtIndex).Length > 0;
        if (Directory.Exists(nodeModules) && hasBuild)
        {
            Console.WriteLine("  node_modules + built bundle present — skipping build.");
            return;
        }
        if (!OnPath("npm") && !OnPath("node"))
        {
            Console.WriteLine("  Node.js not found — cannot build the frontend. Install Node.js LTS,");
            Console.WriteLine("  then run setup again, or run `npm install && npm run build` by hand.");
            return;
        }
        Console.WriteLine("  Installing frontend dependencies (npm install, one time, may take minutes) ...");
        int code = Run("cmd.exe", "/c npm install", appDir);
        if (code != 0)
        {
            Console.WriteLine("  npm install failed — connect to the internet and run setup again.");
            return;
        }
        Console.WriteLine("  Building the app (npm run build) ...");
        code = Run("cmd.exe", "/c npm run build", appDir);
        if (code != 0)
        {
            Console.WriteLine("  npm run build failed — see the error above, then run setup again.");
            return;
        }
        Console.WriteLine("  Frontend built.");
    }

    private static void EnsureFirewall()
    {
        // LAN PCs reach this machine on 8099; without a rule a fresh Windows
        // blocks them. Best effort: fails silently without admin rights.
        Run("netsh.exe", "advfirewall firewall show rule name=\"BlueWrite LAN 8099\"", AppDomain.CurrentDomain.BaseDirectory);
        Run("netsh.exe", "advfirewall firewall add rule name=\"BlueWrite LAN 8099\" dir=in action=allow protocol=TCP localport=8099", AppDomain.CurrentDomain.BaseDirectory);
    }

    private static bool OnPath(string command)
    {
        try
        {
            ProcessStartInfo start = new ProcessStartInfo("where.exe", command);
            start.UseShellExecute = false;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            start.CreateNoWindow = true;
            using (Process child = Process.Start(start))
            {
                child.WaitForExit();
                return child.ExitCode == 0;
            }
        }
        catch (Exception)
        {
            return false;
        }
    }

    private static void CopyDir(string src, string dest)
    {
        Directory.CreateDirectory(dest);
        foreach (string file in Directory.GetFiles(src))
        {
            File.Copy(file, Path.Combine(dest, Path.GetFileName(file)), true);
        }
        foreach (string dir in Directory.GetDirectories(src))
        {
            CopyDir(dir, Path.Combine(dest, Path.GetFileName(dir)));
        }
    }

    private static int Run(string file, string arguments, string workingDirectory)
    {
        try
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
        catch (Exception ex)
        {
            Console.WriteLine("  (could not start " + file + ": " + ex.Message + ")");
            return 1;
        }
    }

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
            return false;
        }
    }

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
        }
    }

    private static void PrintUsage()
    {
        Console.WriteLine("BlueWrite Setup — installs the station system on this PC.");
        Console.WriteLine();
        Console.WriteLine("  BlueWrite-Setup.exe   download the app if needed, install PHP/Node/MySQL");
        Console.WriteLine("                        via winget, set up config + database + frontend build,");
        Console.WriteLine("                        start the servers and open BlueWrite in the browser");
        Console.WriteLine();
        Console.WriteLine("Needs internet on first run (GitHub + winget). Re-run any time: finished");
        Console.WriteLine("steps are skipped, so it doubles as a repair tool.");
    }
}

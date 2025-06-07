# AppZap
show processes; Kill process; Add To kill list on launch; Chron run Kill list;
# macOS Process Manager App — Dev Functional Plan (Apache + CGI Python + HTML/JS)

## App Overview
A web-based process inspector and controller for macOS built with Apache (CGI), Python 3 backend, and a dynamic HTML/CSS/JS frontend. The app scans and visualizes all active processes, apps, services, and executables, tracking CPU, memory, PID, parent process, and net transfer stats. It supports real-time 7-second updates, system process tagging, manual labeling, and process control (kill/whitelist).

## Functional Specs

1. **Backend (Python CGI)**  
   - Expose endpoints via query param:  
     `/cgi-bin/sysinfo.py?action=list` → returns full process snapshot in JSON  
     `/cgi-bin/sysinfo.py?action=kill&pid=PID` → kills single PID  
     `/cgi-bin/sysinfo.py?action=add_kill_list&pid=PID` → adds to persistent kill list  
     `/cgi-bin/sysinfo.py?action=remove_kill_list&pid=PID` → removes from kill list  
     `/cgi-bin/sysinfo.py?action=kill_loop_check` → enforces all kill list rules  
   - All data encoded in JSON.  
   - Track and store kill list in kill_list.json (pattern or PID).  
   - Use `psutil`, `subprocess`, `netstat` for metrics.  
   - Identify system processes via path and UID (0 = system).  
   - Attempt to resolve parent processes and Info.plist metadata for labeling.  
   - Background task can re-kill re-spawned PIDs from kill list.

2. **Frontend (HTML/CSS/JS)**  
   - Poll every 7s → AJAX GET to `action=list`.  
   - Render process table: Name, PID, CPU%, Mem%, Net I/O, Parent  
   - Add "✖" kill button per row to invoke `action=kill&pid=x`  
   - Add "+" icon to add PID to auto-kill list → `add_kill_list`  
   - Modal to manage/view/remove persistent kill list  
   - Manual editable label field per row, saved in localStorage  
   - Color codes:  
     - Red: Root/system  
     - Gray: Background  
     - Green: Labeled  
     - Unknown: Warn icon  

3. **Kill Persistence**  
   - JSON store holds kill targets.  
   - On every list refresh, system re-kills matching PIDs  
   - Supports fuzzy match by name if PID changes  
   - Tracks kill count stats  

4. **Label Resolution**  
   - Use `ps`/`pgrep` to find ancestry chain  
   - Use `mdls`, `plutil`, `codesign` to trace unknown binaries  
   - Match with public Apple/system definitions if available online  

5. **Security**  
   - Only executable via localhost  
   - All CGI inputs sanitized  
   - Backend protected for admin-only via Apache conf  
   - Optional: password or token required for destructive actions 

Step-by-step prompt plan to build a macOS process manager app (HTML/JS UI + Apache CGI Python3 backend):

1. Apache Setup:
   - Enable CGI scripts on Apache (`httpd.conf`)
   - Set Python CGI dir: `/Library/WebServer/CGI-Executables/`
   - Test CGI with sample `hello.py`

2. Python Backend (sysinfo.py):
   - Use `psutil`, `subprocess`, `os`, `json`
   - Output JSON: PID, name, cmdline, CPU%, memory%, net_in/out, parent PID, user
   - Color code by UID (0=root), or if in `/System`
   - Add API actions:
     - `/cgi-bin/sysinfo.py?action=list`
     - `/cgi-bin/sysinfo.py?action=kill&pid=123`
     - `/cgi-bin/sysinfo.py?action=add_kill_list&pid=123`
     - `/cgi-bin/sysinfo.py?action=remove_kill_list&pid=123`
     - `/cgi-bin/sysinfo.py?action=kill_loop_check`

3. Kill List:
   - Store JSON file: `/Library/WebServer/CGI-Executables/kill_list.json`
   - Each entry: PID/Name pattern, label, manual_tag
   - On server start or every request: check and auto-kill

4. Frontend UI (HTML/CSS/JS):
   - AJAX JSON every 7 sec to `/cgi-bin/sysinfo.py?action=list`
   - Display table: PID, Name, CPU, Mem, Net, Label
   - Button [✖] to kill
   - Button [+] to add to always-kill list
   - Color code root/system
   - Editable label cell (manual tagging)
   - Modal: View/edit Kill List

5. Persist Tags:
   - Use localStorage for UI edits (label by user)
   - Send tags to backend on submit

6. Auto Re-Kill:
   - Python background thread or repeated calls to `/action=kill_loop_check`
   - Compare kill list with current procs, repeat kill as needed

7. Identify Process Source:
   - If name unknown, scan `/Applications`, `/System`, `/usr` paths
   - Use `mdls` or `plutil` to extract Info.plist info

8. Safe System Map:
   - Download Apple system process map from Apple Support or open-source db
   - Cache a dictionary of known system PIDs/names/paths
   - Flag unknown/unsafe in red

9. Optional:
   - Add notification icon on successful kills
   - Store kill count per process
   - Export/import kill list

10. Security:
   - Lock backend CGI with admin-only access
   - Sanitize PID input
   - Run backend under elevated privilege carefully
 

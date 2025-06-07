#!/usr/bin/env python3

import cgi
import json
import os
import psutil

# Path to the kill list file, relative to the cgi-bin directory
KILL_LIST_FILE_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "kill_list.json")

def read_kill_list():
    """Reads the kill list from the JSON file."""
    if not os.path.exists(KILL_LIST_FILE_PATH):
        return []
    try:
        with open(KILL_LIST_FILE_PATH, 'r') as f:
            data = json.load(f)
            # Ensure data is a list, and items are dicts with 'pid'
            if isinstance(data, list) and all(isinstance(item, dict) and 'pid' in item for item in data):
                return data
            return [] # Return empty list if format is incorrect
    except (IOError, json.JSONDecodeError):
        return []

def write_kill_list(kill_list_data):
    """Writes the kill list data to the JSON file."""
    try:
        # Ensure parent directory exists
        os.makedirs(os.path.dirname(KILL_LIST_FILE_PATH), exist_ok=True)
        with open(KILL_LIST_FILE_PATH, 'w') as f:
            json.dump(kill_list_data, f, indent=4)
        return True
    except IOError:
        return False

def handle_list_action():
    """Handles the 'list' action and returns process data using psutil."""
    processes_data = []
    # Added 'uids' to attributes to determine if a process is system-level
    attrs = ['pid', 'name', 'cpu_percent', 'memory_percent', 'ppid', 'username', 'uids']
    for proc in psutil.process_iter(attrs=attrs, ad_value=None):
        try:
            pinfo = proc.info
            process_info = {attr: pinfo.get(attr) for attr in attrs if attr != 'uids'} # Handle uids separately for clarity

            # Determine if it's a system process (real UID 0)
            is_system = False # Default to false
            proc_uids = pinfo.get('uids')
            if proc_uids and hasattr(proc_uids, 'real'):
                is_system = (proc_uids.real == 0)

            process_info['is_system_process'] = is_system
            # We might not want to send raw uids to frontend, so it's not included by default in process_info
            # If 'username' is already 'root', that's also a strong indicator handled by 'username' field.

            processes_data.append(process_info)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            # Skip processes that are gone or inaccessible
            pass

    # Get network I/O statistics
    net_io = psutil.net_io_counters()
    network_stats = {
        "bytes_sent": net_io.bytes_sent,
        "bytes_recv": net_io.bytes_recv,
        "packets_sent": net_io.packets_sent,
        "packets_recv": net_io.packets_recv,
        "errin": net_io.errin,
        "errout": net_io.errout,
        "dropin": net_io.dropin,
        "dropout": net_io.dropout,
    }

    data = {
        "status": "success",
        "processes": processes_data,
        "network_stats": network_stats
    }
    return json.dumps(data)

def handle_kill_action(form):
    """Handles the 'kill' action to terminate a process by PID."""
    pid_str = form.getvalue("pid")
    if not pid_str:
        return json.dumps({"status": "error", "message": "PID not provided"})

    try:
        pid = int(pid_str)
        if pid <= 0: # PIDs are positive integers
             raise ValueError("PID must be a positive integer.")
    except ValueError:
        return json.dumps({"status": "error", "message": f"Invalid PID format: {pid_str}"})

    try:
        proc = psutil.Process(pid)
        proc.kill() # Sends SIGKILL
        return json.dumps({"status": "success", "message": f"Process {pid} killed"})
    except psutil.NoSuchProcess:
        return json.dumps({"status": "error", "message": f"Process with PID {pid} not found"})
    except psutil.AccessDenied:
        return json.dumps({"status": "error", "message": f"Permission denied to kill process {pid}"})
    except Exception as e:
        return json.dumps({"status": "error", "message": f"Failed to kill process {pid}: {str(e)}"})

def handle_add_kill_list_action(form):
    """Adds a PID to the kill list."""
    pid_str = form.getvalue("pid")
    if not pid_str:
        return json.dumps({"status": "error", "message": "PID not provided"})

    try:
        pid_to_add = int(pid_str)
        if pid_to_add <= 0:
            raise ValueError("PID must be a positive integer.")
    except ValueError:
        return json.dumps({"status": "error", "message": f"Invalid PID format: {pid_str}"})

    kill_list = read_kill_list()

    # Check if PID already exists (as an integer)
    if any(item.get("pid") == pid_to_add for item in kill_list):
        return json.dumps({"status": "info", "message": f"PID {pid_to_add} is already in the kill list"})

    kill_list.append({"pid": pid_to_add}) # Store as a dictionary

    if write_kill_list(kill_list):
        return json.dumps({"status": "success", "message": f"PID {pid_to_add} added to kill list"})
    else:
        return json.dumps({"status": "error", "message": "Failed to write to kill list file"})

def handle_remove_kill_list_action(form):
    """Removes a PID from the kill list."""
    pid_str = form.getvalue("pid")
    if not pid_str:
        return json.dumps({"status": "error", "message": "PID not provided"})

    try:
        pid_to_remove = int(pid_str)
        if pid_to_remove <= 0:
            raise ValueError("PID must be a positive integer.")
    except ValueError:
        return json.dumps({"status": "error", "message": f"Invalid PID format: {pid_str}"})

    kill_list = read_kill_list()
    original_length = len(kill_list)

    # Filter out the PID to remove, comparing integers
    kill_list = [item for item in kill_list if item.get("pid") != pid_to_remove]

    if len(kill_list) == original_length:
        return json.dumps({"status": "info", "message": f"PID {pid_to_remove} not found in kill list"})

    if write_kill_list(kill_list):
        return json.dumps({"status": "success", "message": f"PID {pid_to_remove} removed from kill list"})
    else:
        return json.dumps({"status": "error", "message": "Failed to write to kill list file"})

def handle_get_kill_list_action():
    """Handles the 'get_kill_list' action."""
    kill_list_data = read_kill_list()
    # read_kill_list already returns a list (empty if error or not found)
    return json.dumps({"status": "success", "kill_list": kill_list_data})

def handle_kill_loop_check_action():
    """
    Iterates through the kill list, attempts to kill each PID,
    and reports the outcome.
    """
    kill_list = read_kill_list()
    killed_count = 0
    error_count = 0
    details = []

    if not kill_list:
        return json.dumps({
            "status": "success",
            "message": "Kill list is empty. No actions taken.",
            "killed_count": 0,
            "error_count": 0,
            "details": []
        })

    for item in kill_list:
        target_pid = item.get("pid")
        if target_pid is None: # Should not happen if list is well-formed
            details.append({"pid": "unknown", "status": "invalid_entry"})
            error_count +=1
            continue

        try:
            proc = psutil.Process(target_pid)
            proc.kill()
            killed_count += 1
            details.append({"pid": target_pid, "status": "killed"})
        except psutil.NoSuchProcess:
            # Process already gone, count as success for cleanup purposes
            details.append({"pid": target_pid, "status": "not_found"})
        except psutil.AccessDenied:
            error_count += 1
            details.append({"pid": target_pid, "status": "access_denied"})
        except Exception as e:
            error_count += 1
            details.append({"pid": target_pid, "status": "error", "message": str(e)})

    return json.dumps({
        "status": "success",
        "killed_count": killed_count,
        "error_count": error_count,
        "details": details
    })

def main():
    """Main function to handle CGI requests."""
    print("Content-Type: application/json")
    print()  # End of headers

    form = cgi.FieldStorage()
    action = form.getvalue("action")

    if action == "list":
        response = handle_list_action()
        print(response)
    elif action == "kill":
        response = handle_kill_action(form)
        print(response)
    elif action == "add_kill_list":
        response = handle_add_kill_list_action(form)
        print(response)
    elif action == "remove_kill_list":
        response = handle_remove_kill_list_action(form)
        print(response)
    elif action == "kill_loop_check":
        response = handle_kill_loop_check_action() # This action does not need form
        print(response)
    elif action == "get_kill_list":
        response = handle_get_kill_list_action()
        print(response)
    else:
        error_data = {
            "status": "error",
            "message": "Invalid action or no action specified"
        }
        print(json.dumps(error_data))

if __name__ == "__main__":
    main()

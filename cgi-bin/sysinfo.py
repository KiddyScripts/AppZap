#!/usr/bin/env python3

import cgi
import json
import psutil
import os
import signal # For os.kill

# Path for the kill list JSON file.
KILL_LIST_FILE = os.path.join(os.path.dirname(__file__), "kill_list.json")

def get_process_info():
    """Gathers detailed information about running processes."""
    processes = []
    for proc in psutil.process_iter(['pid', 'name', 'cmdline', 'cpu_percent', 'memory_percent', 'io_counters', 'ppid', 'username']):
        try:
            try:
                net_io = proc.io_counters()
                net_in = net_io.read_bytes
                net_out = net_io.write_bytes
            except (FileNotFoundError, psutil.AccessDenied, psutil.Error):
                net_in = 0
                net_out = 0

            processes.append({
                'pid': proc.info['pid'],
                'name': proc.info['name'],
                'cmdline': ' '.join(proc.info['cmdline']) if proc.info['cmdline'] else '',
                'cpu_percent': proc.info['cpu_percent'],
                'memory_percent': proc.info['memory_percent'],
                'net_in': net_in,
                'net_out': net_out,
                'ppid': proc.info['ppid'],
                'user': proc.info['username']
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
    return processes

def load_kill_list():
    """Loads the list of PIDs from kill_list.json."""
    if not os.path.exists(KILL_LIST_FILE):
        return []
    try:
        with open(KILL_LIST_FILE, 'r') as f:
            data = json.load(f)
            if isinstance(data, list) and all(isinstance(pid, int) for pid in data):
                return data
            # If data is not a list of integers, treat as invalid.
            return []
    except (IOError, json.JSONDecodeError):
        return []

def save_kill_list(pids):
    """Saves the list of PIDs to kill_list.json."""
    try:
        # Ensure all PIDs are integers before saving
        valid_pids = [pid for pid in pids if isinstance(pid, int)]
        with open(KILL_LIST_FILE, 'w') as f:
            json.dump(valid_pids, f, indent=4)
        return True
    except (IOError, TypeError):
        return False

def sanitize_pid(pid_str):
    """Converts PID string to integer, returns None on failure."""
    if pid_str is None:
        return None
    try:
        return int(pid_str)
    except ValueError:
        return None

def action_kill_process(pid_str):
    """Attempts to kill a process by its PID."""
    pid = sanitize_pid(pid_str)
    if pid is None:
        return {'status': 'error', 'message': 'Invalid or missing PID.'}

    try:
        proc = psutil.Process(pid)
        proc.kill()
        return {'status': 'success', 'message': f'Signal sent to kill process {pid}.'}
    except psutil.NoSuchProcess:
        return {'status': 'error', 'message': f'Process {pid} not found.'}
    except psutil.AccessDenied:
        return {'status': 'error', 'message': f'Access denied to kill process {pid}.'}
    except Exception as e:
        return {'status': 'error', 'message': f'Failed to kill process {pid}: {str(e)}'}

def action_add_to_kill_list(pid_str):
    """Adds a PID to the kill list."""
    pid = sanitize_pid(pid_str)
    if pid is None:
        return {'status': 'error', 'message': 'Invalid or missing PID.'}

    pids = load_kill_list()
    if pid not in pids:
        pids.append(pid)
        if save_kill_list(pids):
            return {'status': 'success', 'message': f'PID {pid} added to kill list.'}
        else:
            return {'status': 'error', 'message': 'Failed to save kill list.'}
    else:
        return {'status': 'success', 'message': f'PID {pid} already in kill list.'}

def action_remove_from_kill_list(pid_str):
    """Removes a PID from the kill list."""
    pid = sanitize_pid(pid_str)
    if pid is None:
        return {'status': 'error', 'message': 'Invalid or missing PID.'}

    pids = load_kill_list()
    if pid in pids:
        pids.remove(pid)
        if save_kill_list(pids):
            return {'status': 'success', 'message': f'PID {pid} removed from kill list.'}
        else:
            return {'status': 'error', 'message': 'Failed to save kill list.'}
    else:
        return {'status': 'error', 'message': f'PID {pid} not found in kill list.'}

def action_kill_loop_check():
    """Checks kill_list.json and attempts to kill listed running processes."""
    pids_to_kill = load_kill_list()
    results = []
    updated_pids = list(pids_to_kill)

    if not pids_to_kill:
        return {'status': 'success', 'message': 'Kill list is empty.', 'results': []}

    for pid_val in pids_to_kill: # Renamed pid to pid_val to avoid conflict with module
        try:
            if psutil.pid_exists(pid_val):
                proc = psutil.Process(pid_val)
                proc_name = proc.name() # Get name before kill, in case of quick termination
                proc.kill()
                results.append({'pid': pid_val, 'status': 'killed', 'name': proc_name})
            else:
                results.append({'pid': pid_val, 'status': 'not_found'})
                if pid_val in updated_pids:
                    updated_pids.remove(pid_val)
        except psutil.AccessDenied:
            proc_name_ad = 'N/A'
            try:
                if psutil.pid_exists(pid_val):
                    proc_name_ad = psutil.Process(pid_val).name()
            except psutil.Error: # Catch errors if process disappears during check
                pass
            results.append({'pid': pid_val, 'status': 'access_denied', 'name': proc_name_ad})
        except psutil.NoSuchProcess:
            results.append({'pid': pid_val, 'status': 'not_found_on_kill_attempt'})
            if pid_val in updated_pids:
                 updated_pids.remove(pid_val)
        except Exception as e:
            results.append({'pid': pid_val, 'status': 'error', 'message': str(e)})

    save_kill_list(updated_pids)
    return {'status': 'success', 'message': 'Kill loop check completed.', 'results': results}

def action_list_kill_list():
    """Loads and returns the kill list."""
    # load_kill_list() already handles file not existing, JSON errors, and returns []
    pids = load_kill_list()
    return {'status': 'success', 'pids': pids}

def main():
    """Handles incoming CGI requests."""
    print("Content-Type: application/json")
    print() # End of headers

    form = cgi.FieldStorage()
    action = form.getvalue("action")
    pid_str = form.getvalue("pid")

    response = {}
    supported_actions = ["list", "kill", "add_kill_list", "remove_kill_list", "kill_loop_check", "list_kill_list"]

    if action == "list":
        try:
            response['status'] = 'success'
            response['processes'] = get_process_info()
        except Exception as e:
            response['status'] = 'error'
            response['message'] = f"An error occurred while listing processes: {str(e)}"
    elif action == "kill":
        response = action_kill_process(pid_str)
    elif action == "add_kill_list":
        response = action_add_to_kill_list(pid_str)
    elif action == "remove_kill_list":
        response = action_remove_from_kill_list(pid_str)
    elif action == "kill_loop_check":
        response = action_kill_loop_check()
    elif action == "list_kill_list": # New action
        response = action_list_kill_list()
    elif action is None:
        response['status'] = 'error'
        response['message'] = f'Action parameter missing. Supported actions: "{", ".join(supported_actions)}"'
    else:
        response['status'] = 'error'
        response['message'] = f'Invalid action "{action}". Supported actions: "{", ".join(supported_actions)}"'

    try:
        print(json.dumps(response, indent=4))
    except Exception as e:
        # Fallback for critical JSON errors, should not happen with current responses
        print(json.dumps({'status': 'error', 'message': f'Critical JSON serialization error: {str(e)}'}))

if __name__ == "__main__":
    main()

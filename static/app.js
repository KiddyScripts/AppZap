document.addEventListener('DOMContentLoaded', () => {
    const API_ENDPOINT = '/cgi-bin/sysinfo.py';
    const REFRESH_INTERVAL = 7000; // 7 seconds

    // DOM Elements
    const processTableBody = document.getElementById('process-list-body');
    const processStatusMessage = document.getElementById('process-status-message');
    const refreshProcessesBtn = document.getElementById('refresh-processes-btn');

    const openKillListModalBtn = document.getElementById('open-kill-list-modal-btn');
    const closeKillListModalBtn = document.getElementById('close-kill-list-modal-btn');
    const killListModal = document.getElementById('kill-list-modal');
    const killListBody = document.getElementById('kill-list-body');
    const killListStatusMessage = document.getElementById('kill-list-status-message');

    const triggerKillLoopBtn = document.getElementById('trigger-kill-loop-btn');
    const killLoopStatusOutput = document.getElementById('kill-loop-status-output');

    // Helper to update status messages
    function updateStatus(element, message, statusClass) {
        if (element) {
            element.textContent = message;
            element.className = statusClass; // Applies one class, removes others
        }
    }

    // --- Helper for API Requests ---
    async function apiRequest(action, params = {}) {
        const queryParams = new URLSearchParams(params);
        const url = `${API_ENDPOINT}?action=${encodeURIComponent(action)}&${queryParams.toString()}`;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }
            const data = await response.json();
            if (data.status === 'error') {
                throw new Error(data.message || `API returned an error for action ${action}`);
            }
            return data;
        } catch (error) {
            console.error(`API request failed for action ${action} with params ${JSON.stringify(params)}:`, error);
            // General API errors update the main process status message.
            // Specific functions might override this for their local status messages if needed.
            updateStatus(processStatusMessage, `Network or server error: ${error.message}`, 'status-error');
            throw error;
        }
    }

    // --- Process Management ---
    function renderProcessTable(processes) {
        if (!processTableBody) {
            console.error("Process table body not found");
            return;
        }
        processTableBody.innerHTML = '';

        if (!processes || processes.length === 0) {
            const colspan = processTableBody.closest('table')?.querySelector('thead tr')?.cells.length || 9;
            processTableBody.innerHTML = `<tr><td colspan="${colspan}">No processes found or an error occurred.</td></tr>`;
            // processStatusMessage is handled by fetchProcesses
            return;
        }

        processes.forEach(proc => {
            const row = processTableBody.insertRow();
            if (proc.user === 'root') {
                row.classList.add('process-row-system');
            }

            row.insertCell().textContent = proc.name || 'N/A';
            row.insertCell().textContent = proc.pid;
            row.insertCell().textContent = proc.user || 'N/A';
            row.insertCell().textContent = proc.cpu_percent !== undefined ? proc.cpu_percent.toFixed(2) : 'N/A';
            row.insertCell().textContent = proc.memory_percent !== undefined ? proc.memory_percent.toFixed(2) : 'N/A';
            const netIO = `In: ${(proc.net_in / 1024).toFixed(2)} / Out: ${(proc.net_out / 1024).toFixed(2)}`;
            row.insertCell().textContent = netIO;
            row.insertCell().textContent = proc.ppid || 'N/A';
            row.insertCell().textContent = proc.cmdline || 'N/A';

            const actionsCell = row.insertCell();
            const killBtn = document.createElement('button');
            killBtn.textContent = '✖ Kill';
            killBtn.classList.add('action-btn', 'kill-btn');
            killBtn.title = `Kill process ${proc.pid}`;
            killBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                killProcess(proc.pid, proc.name, row);
            });
            actionsCell.appendChild(killBtn);

            const addToKillListBtn = document.createElement('button');
            addToKillListBtn.textContent = '+ To Kill List';
            addToKillListBtn.classList.add('action-btn', 'add-kill-list-btn');
            addToKillListBtn.title = `Add process ${proc.pid} to kill list`;
            addToKillListBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                addToKillList(proc.pid, row);
            });
            actionsCell.appendChild(addToKillListBtn);
        });
    }

    async function fetchProcesses() {
        updateStatus(processStatusMessage, 'Loading processes...', 'status-loading');
        try {
            const data = await apiRequest('list');
            renderProcessTable(data.processes);
            updateStatus(processStatusMessage, 'Processes loaded successfully.', 'status-success');
        } catch (error) {
            renderProcessTable([]);
            // Error message is set by apiRequest's catch block for processStatusMessage
        }
    }

    function brieflyHighlightRow(row, className) {
        if (!row) return;
        row.classList.add(className);
        setTimeout(() => {
            row.classList.remove(className);
        }, 1500);
    }

    async function killProcess(pid, name = 'this process', rowElement) {
        if (!confirm(`Are you sure you want to send a kill signal to process ${pid} (${name})?`)) return;
        try {
            const data = await apiRequest('kill', { pid });
            updateStatus(processStatusMessage, data.message || `Kill signal sent to process ${pid}.`, 'status-success');
            brieflyHighlightRow(rowElement, 'row-highlight-error');
            fetchProcesses();
        } catch (error) {
            // apiRequest's catch will update processStatusMessage for general errors.
            // If a more specific message is needed here for kill-specific API errors (that are not network errors):
            // updateStatus(processStatusMessage, `Error killing process ${pid}: ${error.message}`, 'status-error');
        }
    }

    async function addToKillList(pid, rowElement) {
        try {
            const data = await apiRequest('add_kill_list', { pid });
            updateStatus(processStatusMessage, data.message || `Process ${pid} added to kill list.`, 'status-success');
            brieflyHighlightRow(rowElement, 'row-highlight-info');
            if (killListModal && killListModal.style.display === 'block') {
                loadAndRenderKillList();
            }
        } catch (error) {
            // apiRequest's catch will update processStatusMessage.
            // updateStatus(processStatusMessage, `Error adding process ${pid} to kill list: ${error.message}`, 'status-error');
        }
    }

    // --- Kill List Modal ---
    function renderKillListTable(pids) {
        if (!killListBody) {
            console.error("Kill list table body not found");
            return;
        }
        killListBody.innerHTML = '';

        if (!pids || pids.length === 0) {
            const colspan = killListBody.closest('table')?.querySelector('thead tr')?.cells.length || 2;
            killListBody.innerHTML = `<tr><td colspan="${colspan}">Kill list is empty or could not be loaded.</td></tr>`;
            // killListStatusMessage is handled by loadAndRenderKillList
            return;
        }

        pids.forEach(pid => {
            const row = killListBody.insertRow();
            row.insertCell().textContent = pid;

            const removeCell = row.insertCell();
            const removeBtn = document.createElement('button');
            removeBtn.textContent = 'Remove';
            removeBtn.classList.add('action-btn', 'remove-kill-list-btn');
            removeBtn.title = `Remove PID ${pid} from kill list`;
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeFromKillList(pid, row);
            });
            removeCell.appendChild(removeBtn);
        });
    }

    async function loadAndRenderKillList() {
        updateStatus(killListStatusMessage, 'Loading kill list...', 'status-loading');
        try {
            const data = await apiRequest('list_kill_list');
            renderKillListTable(data.pids || []);
            updateStatus(killListStatusMessage, 'Kill list loaded.', 'status-success');
        } catch (error) {
            renderKillListTable([]);
            updateStatus(killListStatusMessage, `Error loading kill list: ${error.message}`, 'status-error');
        }
    }

    function openKillListModal() {
        if (killListModal) {
            loadAndRenderKillList(); // This will set initial status (loading, then success/error)
            killListModal.style.display = 'block';
        }
    }

    function closeKillListModal() {
        if (killListModal) {
            killListModal.style.display = 'none';
            if (killListStatusMessage) killListStatusMessage.textContent = ''; // Clear on close
        }
    }

    async function removeFromKillList(pid, rowElement) {
        // Note: `apiRequest` on error will update `processStatusMessage`, not `killListStatusMessage`.
        // We need to handle errors specifically for `killListStatusMessage` here.
        try {
            const data = await apiRequest('remove_kill_list', { pid });
            updateStatus(killListStatusMessage, data.message || `Process ${pid} removed from kill list.`, 'status-success');
            loadAndRenderKillList(); // This will refresh the list and reset killListStatusMessage to "Kill list loaded."
        } catch (error) {
            // Override the general processStatusMessage update from apiRequest for this specific action
            updateStatus(killListStatusMessage, `Error removing process ${pid}: ${error.message}`, 'status-error');
        }
    }

    // --- Trigger Kill Loop ---
    async function triggerKillLoop() {
        if (!killLoopStatusOutput) return;
        updateStatus(killLoopStatusOutput, 'Running kill loop check...', 'status-loading');
        try {
            const data = await apiRequest('kill_loop_check');
            let htmlOutput = `<strong>Kill Loop Check Completed:</strong> ${data.message || "Processed."}<br>`;
            if (data.results && data.results.length > 0) {
                htmlOutput += '<ul>';
                data.results.forEach(result => {
                    htmlOutput += `<li>PID ${result.pid}: ${result.status}`;
                    if (result.name) htmlOutput += ` (${result.name})`;
                    if (result.message && result.status === 'error') htmlOutput += ` - ${result.message}`;
                    htmlOutput += '</li>';
                });
                htmlOutput += '</ul>';
            } else {
                 htmlOutput += 'No processes were targeted or the kill list was empty.';
            }
            killLoopStatusOutput.innerHTML = htmlOutput; // Set innerHTML for list
            killLoopStatusOutput.className = data.results && data.results.some(r => r.status === 'killed' || r.status === 'access_denied' || r.status === 'error') ? 'status-info' : 'status-success';

            fetchProcesses();
        } catch (error) {
            updateStatus(killLoopStatusOutput, `Error triggering kill loop: ${error.message}`, 'status-error');
        }
    }

    // --- Event Listeners ---
    function initializeEventListeners() {
        if (refreshProcessesBtn) refreshProcessesBtn.addEventListener('click', fetchProcesses);
        else console.error("Refresh button not found");

        if (openKillListModalBtn) openKillListModalBtn.addEventListener('click', openKillListModal);
        else console.error("Open Kill List Modal button not found");

        if (closeKillListModalBtn) closeKillListModalBtn.addEventListener('click', closeKillListModal);
        else console.error("Close Kill List Modal button not found");

        if (triggerKillLoopBtn) triggerKillLoopBtn.addEventListener('click', triggerKillLoop);
        else console.error("Trigger Kill Loop button not found");

        window.addEventListener('click', (event) => {
            if (event.target === killListModal) {
                closeKillListModal();
            }
        });
    }

    // --- Initial Load ---
    initializeEventListeners();
    fetchProcesses();
    setInterval(fetchProcesses, REFRESH_INTERVAL);
});

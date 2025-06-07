// JavaScript for AppZap Process Manager
console.log("script.js loaded");

document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed");

    // --- Configuration ---
    const CGI_SCRIPT_URL = '../cgi-bin/sysinfo.py'; // Path to the Python CGI script

    // --- DOM Elements ---
    const processTableContainer = document.getElementById('process-table-container');
    const networkStatsContainer = document.getElementById('network-stats-container');
    const refreshButton = document.getElementById('refresh-data-btn');
    const globalStatusMessagesDiv = document.getElementById('global-status-messages');

    // Kill List Modal Elements
    const manageKillListBtn = document.getElementById('manage-kill-list-btn');
    const killListModal = document.getElementById('kill-list-modal');
    const closeKillListModalBtn = document.getElementById('close-kill-list-modal-btn');
    const currentKillListUl = document.getElementById('current-kill-list-ul');
    const killListPidInput = document.getElementById('kill-list-pid-input');
    const addToKillListBtn = document.getElementById('add-to-kill-list-btn');
    const removeFromKillListBtn = document.getElementById('remove-from-kill-list-btn');
    const killListStatusDiv = document.getElementById('kill-list-status');

    // --- LocalStorage Helper Functions for Labels ---
    function getLabel(pid) {
        return localStorage.getItem(`label_${pid}`) || '';
    }

    function setLabel(pid, label) {
        if (label && label.trim() !== '') {
            localStorage.setItem(`label_${pid}`, label.trim());
        } else {
            localStorage.removeItem(`label_${pid}`);
        }
    }

    // --- Core Functions ---

    /**
     * Fetches data from the CGI script.
     * @param {string} action - The action to perform (e.g., 'list', 'kill').
     * @param {object} params - Additional parameters for the action.
     * @returns {Promise<object>} - The JSON response from the server.
     */
    async function fetchData(action, params = {}) {
        const urlParams = new URLSearchParams(params);
        urlParams.append('action', action);

        try {
            const response = await fetch(`${CGI_SCRIPT_URL}?${urlParams.toString()}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`Error fetching ${action}:`, error);
            // Display a more user-friendly error on the page if possible
            processTableContainer.innerHTML = `<p class="status-error">Error loading data: ${error.message}. Please check console.</p>`;
            networkStatsContainer.innerHTML = ''; // Clear network stats on error
            throw error; // Re-throw to allow caller to handle
        }
    }

    /**
     * Renders the process list table.
     * @param {Array<object>} processes - Array of process objects.
     */
    function renderProcessTable(processes) {
        if (!processes || processes.length === 0) {
            processTableContainer.innerHTML = '<p>No process data available or an error occurred.</p>';
            return;
        }

        let tableHtml = '<table><thead><tr>';
        // Fixed headers for the process table, added "Label"
        const headers = ["Name", "PID", "CPU %", "Memory %", "Parent PID", "Username", "System Process", "Label", "Actions"];

        tableHtml += '<table><thead><tr>';
        headers.forEach(header => {
            tableHtml += `<th>${header}</th>`;
        });
        tableHtml += '</tr></thead><tbody>';

        processes.forEach(proc => {
            const currentLabel = getLabel(proc.pid);
            let rowClass = proc.is_system_process ? 'is-system-process' : '';
            if (currentLabel) {
                rowClass += (rowClass ? ' ' : '') + 'labeled-process'; // Append class if others exist
            }

            tableHtml += `<tr class="${rowClass}" data-pid-row="${proc.pid}">`; // Add data-pid-row for easy row selection

            // Map process data to fixed headers
            tableHtml += `<td>${proc.name !== null && proc.name !== undefined ? proc.name : 'N/A'}</td>`;
            tableHtml += `<td>${proc.pid !== null && proc.pid !== undefined ? proc.pid : 'N/A'}</td>`;
            tableHtml += `<td>${typeof proc.cpu_percent === 'number' ? proc.cpu_percent.toFixed(2) + '%' : 'N/A'}</td>`;
            tableHtml += `<td>${typeof proc.memory_percent === 'number' ? proc.memory_percent.toFixed(2) + '%' : 'N/A'}</td>`;
            tableHtml += `<td>${proc.ppid !== null && proc.ppid !== undefined ? proc.ppid : 'N/A'}</td>`;
            tableHtml += `<td>${proc.username !== null && proc.username !== undefined ? proc.username : 'N/A'}</td>`;
            tableHtml += `<td>${proc.is_system_process ? 'Yes' : 'No'}</td>`;

            // Label column
            tableHtml += `<td><input type="text" class="process-label-input" data-pid="${proc.pid}" value="${currentLabel}" placeholder="Enter label..."></td>`;

            // Actions column
            tableHtml += `<td>
                <button class="action-kill-btn" data-pid="${proc.pid}" title="Kill Process (✖)">Kill</button>
                <button class="action-add-to-kill-list-btn" data-pid="${proc.pid}" title="Add to Auto-Kill List (+)">Add to Kill List</button>
            </td>`;
            tableHtml += '</tr>';
        });

        tableHtml += '</tbody></table>';
        processTableContainer.innerHTML = tableHtml;
        addProcessActionListeners();
        addLabelInputListeners(); // Add listeners for label inputs
    }

    /**
     * Renders network statistics.
     * @param {object} networkStats - Network statistics object.
     */
    function renderNetworkStats(networkStats) {
        if (!networkStats) {
            networkStatsContainer.innerHTML = '<p>No network data available.</p>';
            return;
        }
        let statsHtml = '';
        for (const key in networkStats) {
            statsHtml += `<p><strong>${key.replace(/_/g, ' ')}:</strong> ${networkStats[key]}</p>`;
        }
        networkStatsContainer.innerHTML = statsHtml;
    }

    /**
     * Loads and displays all data (processes and network).
     */
    async function loadAllData() {
        processTableContainer.innerHTML = '<p>Loading process data...</p>';
        networkStatsContainer.innerHTML = '<p>Loading network data...</p>';
        try {
            const data = await fetchData('list');
            if (data && data.status === 'success') {
                renderProcessTable(data.processes);
                renderNetworkStats(data.network_stats);

                // After rendering main data, perform the kill loop check
                fetchData('kill_loop_check')
                    .then(killLoopResponse => {
                        if (killLoopResponse && killLoopResponse.status === 'success') {
                            console.log('Kill loop check result:', killLoopResponse);
                            if (killLoopResponse.killed_count > 0 || killLoopResponse.error_count > 0 || (killLoopResponse.details && killLoopResponse.details.length > 0)) {
                                displayGlobalStatus(`Kill loop: ${killLoopResponse.killed_count} killed, ${killLoopResponse.error_count} errors. Affected PIDs: ${killLoopResponse.details.map(d => d.pid).join(', ') || 'None'}.`, 'info');
                                // No immediate refresh here by design, next 7-sec interval will update.
                                // If any process was killed, loadAllData() will be called by the interval soon.
                            } else {
                                console.log("Kill loop check: No processes on kill list or no actions taken.");
                            }
                        } else {
                            console.warn('Kill loop check failed or returned non-success status:', killLoopResponse);
                            // Optionally display a subtle error for kill_loop_check failure
                            // displayGlobalStatus('Kill loop check failed to execute properly.', 'error');
                        }
                    })
                    .catch(error => {
                        console.error('Error during kill_loop_check:', error);
                        // displayGlobalStatus('Error occurred during kill loop check.', 'error');
                    });

            } else {
                throw new Error(data.message || 'Failed to load data.');
            }
        } catch (error) {
            // Error already logged by fetchData, specific UI updates might be needed here
            // For example, if processTableContainer was not updated by fetchData's catch block
            if(processTableContainer.innerHTML.includes('Loading process data...')) { // Check if not already set by fetchData
                 processTableContainer.innerHTML = `<p class="status-error">Failed to load process data. Check console.</p>`;
            }
            networkStatsContainer.innerHTML = `<p class="status-error">Failed to load network data. Check console.</p>`;
        }
    }

    // --- Process Actions (Kill, Add to Kill List from table) ---
    function addProcessActionListeners() { // Renamed for clarity if only process actions here
        document.querySelectorAll('.action-kill-btn').forEach(button => {
            button.addEventListener('click', async (event) => {
                const pid = event.target.dataset.pid;
                if (confirm(`Are you sure you want to kill process PID: ${pid}?`)) {
                    try {
                        const result = await fetchData('kill', { pid });
                        displayGlobalStatus(result.message || (result.status === 'success' ? `Process ${pid} action initiated.` : `Failed to initiate kill for ${pid}.`), result.status);
                        if (result.status === 'success') loadAllData(); // Refresh list
                    } catch (error) {
                        displayGlobalStatus(`Error killing process ${pid}. See console.`, 'error');
                    }
                }
            });
        });

        document.querySelectorAll('.action-add-to-kill-list-btn').forEach(button => {
            button.addEventListener('click', async (event) => {
                const pid = event.target.dataset.pid;
                try {
                    const result = await fetchData('add_kill_list', { pid });
                    displayGlobalStatus(result.message || (result.status === 'success' ? `PID ${pid} processed for kill list.` : `Failed to process PID ${pid} for kill list.`), result.status);
                    // If modal is open and action was successful or informational (e.g. already exists), refresh its kill list view
                    if ((result.status === 'success' || result.status === 'info') && killListModal.style.display !== 'none') {
                        loadKillListData();
                    }
                } catch (error) {
                     displayGlobalStatus(`Error adding PID ${pid} to kill list. See console.`, 'error');
                }
            });
        });
    }

    function addLabelInputListeners() {
        document.querySelectorAll('.process-label-input').forEach(input => {
            if (input.dataset.listenerAttached) return;

            input.addEventListener('blur', (event) => {
                const pid = event.target.dataset.pid;
                const labelValue = event.target.value;
                setLabel(pid, labelValue);

                // Update the row's class
                const row = document.querySelector(`tr[data-pid-row="${pid}"]`);
                if (row) {
                    if (labelValue.trim() !== '') {
                        row.classList.add('labeled-process');
                    } else {
                        row.classList.remove('labeled-process');
                    }
                }
            });
            input.dataset.listenerAttached = 'true';
        });
    }


    // --- Kill List Modal Functions ---
    function openKillListModal() {
        killListModal.style.display = 'flex'; // Use flex for centering
        loadKillListData();
        killListPidInput.value = '';
        killListStatusDiv.textContent = '';
        killListStatusDiv.className = ''; // Clear previous status styling
    }

    function closeKillListModal() {
        killListModal.style.display = 'none';
    }

    /**
     * Loads and displays the current kill list in the modal.
     */
    async function loadKillListData() {
        currentKillListUl.innerHTML = '<li>Loading...</li>';
        try {
            // Assuming read_kill_list is implicitly handled by 'list' or we need a new action
            // For now, let's assume the kill list is part of the 'list' action for simplicity,
            // or create a dedicated 'get_kill_list' action if it's cleaner.
            // Python side: read_kill_list() is already there.
            // We need a new CGI action 'get_kill_list'
            // OR, for now, we'll manage it client-side after add/remove and assume it's small.
            // Let's make a dedicated action 'get_kill_list' for robustness.
            // If not, we'll have to just show what we've added/removed.

            // For now, this will be a placeholder until 'get_kill_list' is implemented
            // We will simulate it by fetching all data and extracting it if available
            // This is inefficient if kill_list is not part of 'list' response.
            // Let's assume we need a dedicated 'get_kill_list' action.
            // For now, the add/remove will update status, but list won't auto-refresh here without it.

            // Fetch the kill list from the backend
            const response = await fetchData('get_kill_list');
            currentKillListUl.innerHTML = ''; // Clear previous list (Loading... or old data)

            if (response && response.status === 'success' && response.kill_list) {
                if (response.kill_list.length === 0) {
                    currentKillListUl.innerHTML = '<li>Kill list is empty.</li>';
                } else {
                    response.kill_list.forEach(item => {
                        const li = document.createElement('li');
                        li.textContent = `PID: ${item.pid} `;

                        const removeBtn = document.createElement('button');
                        removeBtn.textContent = 'Remove (✖)';
                        removeBtn.classList.add('action-remove-from-kill-list-modal-btn'); // New class for these buttons
                        removeBtn.dataset.pid = item.pid;
                        li.appendChild(removeBtn);

                        currentKillListUl.appendChild(li);
                    });
                    // Add event listeners to the newly created remove buttons
                    addModalRemoveButtonListeners();
                }
            } else {
                 currentKillListUl.innerHTML = '<li>Could not load kill list data.</li>';
                 console.error("Failed to load kill list:", response ? response.message : "No response");
            }
        } catch (error) {
            currentKillListUl.innerHTML = '<li>Error loading kill list. See console.</li>';
            console.error('Error in loadKillListData:', error);
        }
    }

    function addModalRemoveButtonListeners() {
        document.querySelectorAll('.action-remove-from-kill-list-modal-btn').forEach(button => {
            // Prevent adding multiple listeners if buttons are somehow re-rendered without full clear
            if (button.dataset.listenerAttached) return;

            button.addEventListener('click', async (event) => {
                const pid = event.target.dataset.pid;
                if (confirm(`Are you sure you want to remove PID ${pid} from the kill list?`)) {
                    try {
                        const result = await fetchData('remove_kill_list', { pid });
                        displayKillListStatus(result.message || `PID ${pid} removal processed.`, result.status);
                        if (result.status === 'success' || result.status === 'info') {
                            loadKillListData(); // Refresh the list in the modal
                        }
                    } catch (error) {
                        displayKillListStatus(`Error removing PID ${pid}. See console.`, 'error');
                    }
                }
            });
            button.dataset.listenerAttached = 'true';
        });
    }

    function displayKillListStatus(message, type = 'info') { // type can be 'success', 'error', 'info'
        killListStatusDiv.textContent = message;
        killListStatusDiv.className = `status-${type}`; // Applies .status-success, .status-error, or .status-info

        // Clear status after a few seconds
        setTimeout(() => {
            killListStatusDiv.textContent = '';
            killListStatusDiv.className = '';
        }, 5000);
    }

    async function addToKillList() {
        const pid = killListPidInput.value.trim();
        if (!pid || !/^\d+$/.test(pid) || parseInt(pid) <= 0) {
            displayKillListStatus('Please enter a valid positive PID.', 'error');
            return;
        }
        try {
            const result = await fetchData('add_kill_list', { pid });
            displayKillListStatus(result.message || `PID ${pid} processed.`, result.status);
            if (result.status === 'success' || result.status === 'info') { // Refresh list on success or if already exists
                loadKillListData();
                killListPidInput.value = ''; // Clear input
            }
        } catch (error) {
            displayKillListStatus(`Error adding PID ${pid} to kill list.`, 'error');
        }
    }

    async function removeFromKillList() {
        const pid = killListPidInput.value.trim();
        if (!pid || !/^\d+$/.test(pid) || parseInt(pid) <= 0) {
            displayKillListStatus('Please enter a valid positive PID to remove.', 'error');
            return;
        }
        try {
            const result = await fetchData('remove_kill_list', { pid });
            displayKillListStatus(result.message || `PID ${pid} processed for removal.`, result.status);
             if (result.status === 'success' || result.status === 'info') { // Refresh list on success or if not found
                loadKillListData();
                killListPidInput.value = ''; // Clear input
            }
        } catch (error) {
            displayKillListStatus(`Error removing PID ${pid} from kill list.`, 'error');
        }
    }


    // --- Event Listeners ---
    if (refreshButton) {
        refreshButton.addEventListener('click', loadAllData);
    }

    if (manageKillListBtn) {
        manageKillListBtn.addEventListener('click', openKillListModal);
    }
    if (closeKillListModalBtn) {
        closeKillListModalBtn.addEventListener('click', closeKillListModal);
    }
    if (addToKillListBtn) {
        addToKillListBtn.addEventListener('click', addToKillList);
    }
    if (removeFromKillListBtn) {
        removeFromKillListBtn.addEventListener('click', removeFromKillList);
    }

    // Close modal if clicked outside the modal content
    window.addEventListener('click', (event) => {
        if (event.target === killListModal) {
            closeKillListModal();
        }
    });


    // --- Initial Load ---
    loadAllData();

    // Placeholder for periodic refresh and kill loop (to be implemented later if needed)
    // setInterval(loadAllData, 30000); // Refresh data every 30 seconds
    setInterval(loadAllData, 7000); // Refresh data every 7 seconds (as per subtask)

    // --- Global Status Display Function ---
    function displayGlobalStatus(message, type = 'info') { // type can be 'success', 'error', 'info'
        if (!globalStatusMessagesDiv) return; // Guard if the element isn't on the page
        globalStatusMessagesDiv.textContent = message;
        globalStatusMessagesDiv.className = `status-${type}`; // Applies .status-success, .status-error, or .status-info
        globalStatusMessagesDiv.style.display = 'block';

        // Clear status after 5 seconds
        setTimeout(() => {
            globalStatusMessagesDiv.textContent = '';
            globalStatusMessagesDiv.style.display = 'none';
            globalStatusMessagesDiv.className = '';
        }, 5000);
    }

    // Modify existing displayKillListStatus to use the global one or keep it separate if style needs to differ
    // For now, the kill list modal uses its own status div, which is fine.

    // setInterval(async () => {
    //     console.log("Running kill loop check...");
    //     const result = await fetchData('kill_loop_check');
    //     console.log("Kill loop check result:", result);
    //     if (result.killed_count > 0 || result.error_count > 0) { // Refresh if any action was attempted
    //          displayGlobalStatus(`Kill loop check: ${result.killed_count} killed, ${result.error_count} errors.`, 'info');
    //          loadAllData();
    //     }
    // }, 60000); // Run kill loop check every 60 seconds
});

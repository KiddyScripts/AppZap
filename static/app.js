async function fetchProcesses() {
    const res = await fetch('../cgi-bin/sysinfo.py?action=list');
    const data = await res.json();
    renderTable(data.processes);
}

function renderTable(processes) {
    const tbody = document.querySelector('#proc-table tbody');
    tbody.innerHTML = '';
    processes.forEach(proc => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${proc.pid}</td>
            <td>${proc.name}</td>
            <td>${proc.cpu_percent}</td>
            <td>${proc.memory_percent.toFixed(1)}</td>
            <td>${proc.user}</td>
            <td><button class="kill" data-pid="${proc.pid}">✖</button></td>`;
        tbody.appendChild(tr);
    });
}

async function killPid(pid) {
    await fetch(`../cgi-bin/sysinfo.py?action=kill&pid=${pid}`);
    fetchProcesses();
}

document.addEventListener('click', e => {
    if (e.target.matches('button.kill')) {
        const pid = e.target.getAttribute('data-pid');
        killPid(pid);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    fetchProcesses();
    setInterval(fetchProcesses, 7000);
});

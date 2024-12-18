const vscode = require('vscode');




async function generateDashboardHTML(metrics){
    const document = vscode.window.activeTextEditor?.document;
    if (!document){
        return '<h1>No Active File</h1><p>Please open a file to analyze complexity.</p>';
    }

    const rows = metrics.map(metric => 
        `<tr>
            <td>${metric.name}</td>
            <td>${metric.lines.start}-${metric.lines.end}</td>
            <td>${metric.complexity}</td>
            <td>${metric.maintainability}</td>
            <td>${metric.errors}</td>
            <td>
                ${metric.complexity > 9 ? 
                    `<button onclick="vscode.postMessage({command: 'refactor', functionName: '${metric.name}'})">
                        Refactor
                    </button>` : 
                    'N/A'
                }
            </td>
        </tr>`
    ).join('');

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Complexity Metrics</title>
        <style>
            body { font-family: Candara, Arial, sans-serif; padding: 1rem; color: black;}
            h1 { text-align: center; color: white; font-weight: 700; font-size:30px;}
            table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: center; font-size: 20px; color: white;}
            th { background-color: #f4f4f4; color: black; }
            button { 
                background-color: #4CAF50; 
                border: none; 
                color: white; 
                padding: 5px 10px; 
                text-align: center; 
                text-decoration: none; 
                display: inline-block; 
                font-size: 14px; 
                margin: 4px 2px; 
                cursor: pointer; 
                border-radius: 4px; 
            }
            button:hover { background-color: #45a049; }
        </style>
        <script>
            const vscode = acquireVsCodeApi();
        </script>
    </head>
    <body>
        <h1>Complexity & Optimization Metrics</h1>
        <table>
            <thead>
                <tr>
                    <th>Function</th>
                    <th>Lines</th>
                    <th>Cyclomatic Complexity</th>
                    <th>Maintainability</th>
                    <th>Errors</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    </body>
    </html>`;
}


module.exports = { generateDashboardHTML };

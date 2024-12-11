const vscode = require('vscode');
const escomplex = require('typhonjs-escomplex');
const path = require('path');

const { handleFunctionRefactoring } = require('./refactoring.js');
const { generateDashboardHTML } = require('./ui.js');
const { isValidSourceFile } = require('./utils.js');



function analyzeComplexity(document) {
    if (!document) {
      vscode.window.showErrorMessage("No active document found.");
      return null;
    }
  
    const sourceCode = document.getText();
  
    if (!sourceCode || typeof sourceCode !== 'string') {
      vscode.window.showErrorMessage("The file is empty or invalid.");
      return null;
    }
  
    try {
      const analysis = escomplex.analyzeModule(sourceCode);
  
      if (!analysis || !analysis.methods) {
        vscode.window.showErrorMessage("Failed to analyze complexity. Invalid results.");
        console.error("Analysis output:", analysis);
        return null;
      }

      const metrics =[];
      const lenghtOfAnalysis = analysis.methods.length;

      for (let i=0; i<lenghtOfAnalysis; i++){
        const data = analysis.methods[i]
            const metric ={
                "name" : data.name,
                "complexity": data.cyclomatic,
                "maintainability": calculateMaintainability(data.halstead.effort, data.cyclomatic, data.sloc.logical),
                "lines":  {"start": data.lineStart, "end": data.lineEnd},
                "errors": data.errors.length
            }
            metrics.push(metric);
      }
      return metrics;
    } catch (error) {
      console.error(error);
      return null;
    }
}


/**
 * Highlights functions in the editor based on their complexity.
 * metrics - List of function metrics containing name, complexity, and line ranges.
 */
function highlightComplexFunctions(state,metrics) {
    if (!state.activeEditor) {
        console.error("No active editor found.");
        return;
    }

    if(state.activeEditor.document.lineCount<10){
        return ;
    }

    if (!isValidSourceFile(vscode.window.activeTextEditor.document)){
        return;
    }
    
    if (!metrics || metrics.length === 0 || state.activeEditor.document.lineCount < 10) {
        state.activeEditor.setDecorations(state.complexityDecorationType, []);
        state.activeEditor.setDecorations(state.refactorDecorationType, []);
        return;
    }

    const complexityDecorations = [];
    const refactorDecorations = [];
    state.complexityRanges.clear(); 
  
    for (const metric of metrics) {
        if (
            !metric ||
            !metric.lines ||
            typeof metric.lines.start !== "number" ||
            typeof metric.lines.end !== "number"
        ) {
            console.warn("Skipping invalid metric:", metric);
            continue;
        }
  
        const startLine = metric.lines.start - 1;
        const endLine = metric.lines.end - 1;
  
        try {
            const range = new vscode.Range(
                startLine,
                0,
                endLine,
                state.activeEditor.document.lineAt(endLine).text.trim().length
            );
  
            const hoverMessage =
                metric.complexity > 9
                    ? `⚠️ High Complexity (${metric.complexity}) - Consider refactoring "${metric.name}".`
                    : `✓ Optimal Complexity (${metric.complexity}) - "${metric.name}" is well-structured.`;
  
            const decoration = {
                range: range,
                hoverMessage: hoverMessage,
                renderOptions: {
                    after: {
                        contentText: metric.complexity > 9 ? "⚠️ High" : "✓ Optimal",
                        color: metric.complexity > 9 ? "red" : "green",
                        margin: "0 0 0 1rem",
                        fontWeight: "bold",
                    },
                },
            };
  
            complexityDecorations.push(decoration);

            // Add refactor gutter icon for high-complexity functions
            if (metric.complexity > 9) {
                const refactorRange = new vscode.Range(
                    startLine, 
                    0, 
                    startLine, 
                    0
                );
                 // Store the function range for later reference in refactoring
                state.complexityRanges.set(metric.name, range);

                const repoRoot = path.join(__dirname, '../../');

                refactorDecorations.push({
                    range: refactorRange,
                    hoverMessage: `Refactor high complexity function: ${metric.name}`,
                    renderOptions: {
                        gutterIconPath: vscode.Uri.file(
                            path.join(repoRoot, "resources/images/refactor-icon.svg")
                        ),
                        gutterIconSize: "contain",
                        cursor: "pointer", 
                    },
                });
            }
        } catch (error) {
             console.error(
                 `Error creating range for metric: ${metric.name}`,
                 error
             );
         }
        }

     state.activeEditor.setDecorations(state.complexityDecorationType, complexityDecorations);
     state.activeEditor.setDecorations(state.refactorDecorationType, refactorDecorations);
}

function calculateMaintainability(halsteadEffort, cyclomatic, sloc) {
    const epsilon = 1e-5;
    const effortLn = Math.log(halsteadEffort + epsilon);
    const slocLn = Math.log(sloc + epsilon);

    const MI = Math.max(
        0,
        (171 - 5.2 * effortLn - 0.23 * cyclomatic - 16.2 * slocLn) * 100 / 171
    );
    return MI.toFixed(2); 
}





// Update  showComplexityDashboard function to handle webview messages
async function showComplexityDashboard(state){
    if (!state.activeEditor || state.activeEditor.document.lineCount <= 1){
        vscode.window.showErrorMessage("Editor is Empty or No Active Editor");
        return;
    }

    const documentPath = state.activeEditor.document.fileName;
    const documentContent = state.activeEditor.document.getText();
    
    const panel = vscode.window.createWebviewPanel(
        'complexityDashboard',
        'Complexity & Optimization Metrics',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    ); 


    const metrics = analyzeComplexity(state.activeEditor.document);

    // Generate HTML content
    panel.webview.html = await generateDashboardHTML(metrics);

    // Handle messages from the webview
    panel.webview.onDidReceiveMessage(
        async (message) => {
            console.log('Message received from webview:', message);
            switch (message.command) {
                case 'refactor':
                    const matchingEditors = vscode.window.visibleTextEditors.filter(
                        editor => 
                            editor.document.fileName === documentPath && 
                            editor.document.getText() === documentContent
                    );

                    if (matchingEditors.length === 0) {
                        // Try to open the file if it's not currently visible
                        try {
                            const document = await vscode.workspace.openTextDocument(documentPath);
                            const editor = await vscode.window.showTextDocument(document);
                            
                            console.log(`Refactoring function: ${message.functionName}`);
                            state.activeEditor = editor;
                            await handleFunctionRefactoring(state,message.functionName);
                        } catch (error) {
                            vscode.window.showErrorMessage(`Cannot find or open the original document: ${error.message}`);
                        }
                        return;
                    }

                    const targetEditor = matchingEditors[0];
                    
                    console.log(`Refactoring function: ${message.functionName}`);
                    state.activeEditor = targetEditor;
                    await handleFunctionRefactoring(state,message.functionName);
                    break;
            }
        },
        undefined,
    );
}

module.exports = { analyzeComplexity, showComplexityDashboard, highlightComplexFunctions};

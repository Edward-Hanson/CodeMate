const vscode = require('vscode');
const escomplex = require('typhonjs-escomplex');
const path = require('path');


function activateComplexityAnalysis(state) {
    const editor = state.activeEditor;
    if (!editor || editor.document.lineCount <= 1) return;

    const metrics = analyzeComplexity(editor.document);
    highlightComplexFunctions(state, metrics);
}

function analyzeComplexity(document) {
    const sourceCode = document.getText();
    const analysis = escomplex.analyzeModule(sourceCode);
    return analysis.methods.map((method) => ({
        name: method.name,
        complexity: method.cyclomatic,
        maintainability: calculateMaintainability(method.halstead.effort, method.cyclomatic, method.sloc.logical),
        lines: { start: method.lineStart, end: method.lineEnd },
    }));
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

                refactorDecorations.push({
                    range: refactorRange,
                    hoverMessage: `Refactor high complexity function: ${metric.name}`,
                    renderOptions: {
                        gutterIconPath: vscode.Uri.file(
                            path.join(__dirname, "resources/images/refactor-icon.svg")
                        ),
                        gutterIconSize: "contain",
                        cursor: "pointer", // Ensures pointer cursor on hover
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

     // Use the complexity decoration type
     state.activeEditor.setDecorations(state.complexityDecorationType, complexityDecorations);
     // Use the refactor decoration type for gutter icons
     state.activeEditor.setDecorations(state.refactorDecorationType, refactorDecorations);
}

function calculateMaintainability(effort, cyclomatic, sloc) {
    const lnEffort = Math.log(effort + 1);
    const lnSloc = Math.log(sloc + 1);
    return Math.max(0, (171 - 5.2 * lnEffort - 0.23 * cyclomatic - 16.2 * lnSloc) * 100 / 171).toFixed(2);
}

module.exports = { analyzeComplexity, activateComplexityAnalysis, highlightComplexFunctions };

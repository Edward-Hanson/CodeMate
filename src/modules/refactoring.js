const vscode = require('vscode');



/**
 * Handle refactoring for a high-complexity function
 * @param {string} functionName 
 */
async function handleFunctionRefactoring(state,functionName) {
    try {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage("No active editor found.");
            return;
        }

        // Find the function's range
        const functionRange = state.complexityRanges.get(functionName);
        if (!functionRange) {
            vscode.window.showInformationMessage(`Function "${functionName}" not found.`);
            return;
        }

        // Show a loading notification
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Analyzing and preparing to refactor function: ${functionName}`,
            cancellable: true
        }, async (progress, token) => {
            // Check for cancellation
            if (token.isCancellationRequested) {
                return;
            }

            progress.report({ increment: 10, message: "Extracting function code..." });
            
            // Extract full function code
            const functionCode = extractFunctionCode(state, functionRange.start.line);
            if (!functionCode) {
                vscode.window.showErrorMessage(`Could not extract code for function: ${functionName}`);
                return;
            }

            progress.report({ increment: 30, message: "Requesting refactoring suggestions..." });
            
            // Request refactoring
            const refactoredResult = await requestFunctionRefactoring(functionCode);

            progress.report({ increment: 40, message: "Preparing refactoring..." });

            // Create a workspace edit to replace the function
            const edit = new vscode.WorkspaceEdit();
            edit.replace(editor.document.uri, functionRange, refactoredResult);
            
            // Apply the edit
            await vscode.workspace.applyEdit(edit);

            progress.report({ increment: 20, message: "Refactoring complete!" });

            // Show success message
            vscode.window.showInformationMessage(`Successfully refactored function: ${functionName}`);
        });

    } catch (error) {
        console.error('Refactoring error:', error);
        vscode.window.showErrorMessage(`Refactoring failed: ${error.message}`);
    }
}


/**
 * Extract complete function code
 * @param {number} startLine 
 */
function extractFunctionCode(state,startLine) {
    if (!state.activeEditor) return null;

    const document = state.activeEditor.document;
    let braceCount = 0;
    let foundOpening = false;
    let code = [];
    let line = startLine;

    while (line < document.lineCount) {
        const text = document.lineAt(line).text;
        code.push(text);

        for (const char of text) {
            if (char === '{') {
                foundOpening = true;
                braceCount++;
            } else if (char === '}') {
                braceCount--;
            }
        }

        if (foundOpening && braceCount === 0) {
            return code.join('\n');
        }

        line++;
    }
    return null;
}

/**
 * Extract refactored code from API response
 * @param {string} response 
 */
function extractRefactoredCode(response) {
    const codeMatch = response.match(/```javascript\n([\s\S]*?)```/);
    return codeMatch ? codeMatch[1].trim() : response.trim();
}


/**
 * Request function refactoring from API
 * @param {string} functionCode 
 */
async function requestFunctionRefactoring(functionCode) {
    const apiUrl = "https://ai-api.amalitech.org/api/v1/public/chat";
    const prompt = `As an Expert Software Developer, refactor the following JavaScript function:

Refactoring Guidelines:
1. Improve code readability
2. Reduce cyclomatic complexity
3. Follow best practices
4. Maintain original functionality
5. Add comments explaining key changes

Function to Refactor:
\`\`\`javascript
${functionCode}
\`\`\`

Please return ONLY the refactored code. Do not include any additional text or explanations.`;

    //const modelId = "a58c89f1-f8b6-45dc-9727-d22442c99bc3";

    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "X-API-KEY": "MHzEqNKyVPYftQQgbbxv3y2sruZQ5Swk",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ prompt, stream: false})
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.statusText}`);
        }

        const data = await response.json();
        return extractRefactoredCode(data.data.content);
    } catch (error) {
        throw new Error(`Refactoring failed: ${error.message}`);
    }
}


module.exports = { handleFunctionRefactoring, extractFunctionCode };

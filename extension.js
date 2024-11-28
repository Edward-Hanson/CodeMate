const vscode = require('vscode');
const path = require('path');


/**
 * Extension state management for CodeMate
 */
const state = {
    activeEditor: null,
    decorationType: null,
    batchDecorationType: null,
    functionRanges: new Map(),
    lastProcessedVersion: undefined,
    isEditingFunction: false,
    lastClickTime: 0,
    batchStatusBarItem: null,
    lastTypingTime: 0,
    editingTimeout: null
};

/**
 * Activate the extension
 * @param {vscode.ExtensionContext} context 
 */
function activate(context) {
    // Initialize decoration type for individual functions
    state.decorationType = vscode.window.createTextEditorDecorationType({
        after: {
            contentText: '⚡Test',
            color: new vscode.ThemeColor('editorLink.activeForeground'),
            margin: '0 0 0 1rem',
            fontWeight: 'normal',
            backgroundColor: 'transparent',
            textDecoration: 'none; cursor: pointer !important;'
        },
        cursor: 'pointer',
        backgroundColor: { id: 'editor.background' },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });

    
    // Create status bar item for batch testing
    state.batchStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        1000  
    );
    state.batchStatusBarItem.text = "$(zap)"; 
    state.batchStatusBarItem.tooltip = "Generate tests for all functions";
    state.batchStatusBarItem.command = 'extension.generateTestsForAllFunctions';
    context.subscriptions.push(state.batchStatusBarItem);


    // Register commands
    let disposable = vscode.commands.registerTextEditorCommand(
        'extension.generateTestForFunction',
        (textEditor, edit, args) => handleTestGeneration(args, true)
    );

    let batchDisposable = vscode.commands.registerTextEditorCommand(
        'extension.generateTestsForAllFunctions',
        (textEditor) => handleBatchTestGeneration(textEditor)
    );

    context.subscriptions.push(disposable, batchDisposable);

    // Register editor event handlers
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(handleEditorChange),
        vscode.workspace.onDidChangeTextDocument(handleDocumentChange),
        vscode.window.onDidChangeTextEditorSelection(handleSelectionChange)
    );

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && isValidSourceFile(activeEditor.document)) {
        handleEditorChange(activeEditor);
    }
}

/**
 * Handle active editor changes
 * @param {vscode.TextEditor} editor 
 */
function handleEditorChange(editor) {
    state.activeEditor = editor;
    if (editor) {
        updateDecorations();
        updateBatchButton();
    }
    else{
        state.batchStatusBarItem.hide();
    }
}

/**
 * Handle document changes
 * @param {vscode.TextDocumentChangeEvent} event 
 */
function handleDocumentChange(event) {
    const activeDocument = state.activeEditor?.document;
    if (!activeDocument || event.document !== activeDocument) return;

    // More sophisticated debounce mechanism
    state.isEditingFunction = true;
    
    // Longer and more controlled delay
    clearTimeout(state.editingTimeout);
    state.editingTimeout = setTimeout(() => {
        state.isEditingFunction = false;
    }, 2000); // Increased to 2 seconds

    state.lastProcessedVersion = event.document.version;
    
    // Only update if significant changes occur
    const significantChange = event.contentChanges.some(change => 
        change.text.trim().length > 0 && 
        !change.text.match(/^\s*\/\//) 
    );

    if (significantChange) {
        updateDecorations();
        updateBatchButton();
    }
}


/**
 * Update the batch test button visibility
*/
function updateBatchButton() {
    if (!state.activeEditor) {
        state.batchStatusBarItem.hide();
        return;
    }

    const document = state.activeEditor.document;
    if (!isValidSourceFile(document)) {
        state.batchStatusBarItem.hide();
    }

    if (state.functionRanges.size >= 2) {
        state.batchStatusBarItem.show();
    } else {
        state.batchStatusBarItem.hide();
    }
}

/**
 * Handle selection changes for decoration clicks
 * @param {vscode.TextEditorSelectionChangeEvent} event 
 */
function handleSelectionChange(event) {
    if (!state.activeEditor || event.textEditor !== state.activeEditor) {
        return;
    }

    const selection = event.selections[0];
    if (!selection || !selection.isEmpty) {
        return;
    }
    updateDecorations();
    updateBatchButton();

    const position = selection.active;
    const document = state.activeEditor.document;
    const line = document.lineAt(position.line);
    const lineLength = line.text.length;
    const currentTime = Date.now();

    const CLICK_DEBOUNCE_TIME = 2000; 
    const TYPING_COOLDOWN = 2000;

    if (state.isEditingFunction || 
        (currentTime - (state.lastTypingTime || 0) < TYPING_COOLDOWN)) {
        return;
    }

    // Batch test generation click
    if (line.lineNumber === document.lineCount - 1 && 
        state.functionRanges.size >= 2 &&
        currentTime - state.lastClickTime > CLICK_DEBOUNCE_TIME) {
        const isBatchClick = 
            position.character >= lineLength - 2 && 
            position.character <= lineLength + 1;

        if (isBatchClick && event.selections.length > 1) {
            state.lastClickTime = currentTime;
            handleBatchTestGeneration(state.activeEditor);
            return;
        }
    }

    // Single function test generation click
    const isDeliberateClick = 
        position.character >= lineLength - 15 && 
        position.character <= lineLength + 10 &&
        currentTime - state.lastClickTime > CLICK_DEBOUNCE_TIME;

    if (isDeliberateClick) {
        state.lastClickTime = currentTime;
        for (const [name, range] of state.functionRanges) {
            if (range.start.line === position.line) {
                const functionInfo = {
                    name,
                    range,
                    code: extractFunctionCode(range.start.line)
                };
                handleTestGeneration(functionInfo, false);
                break;
            }
        }
    }
}

/**
 * Update function decorations in the editor
 */
function updateDecorations() {
    if (!state.activeEditor) return;

    const document = state.activeEditor.document;
    if (!isValidSourceFile(document)) {
        state.activeEditor.setDecorations(state.decorationType,[]);
        return;
    }

    detectFunctions(document);
    const decorations = createDecorations();
    state.activeEditor.setDecorations(state.decorationType, decorations);
}

/**
 * Check if the file should be processed
 * @param {vscode.TextDocument} document 
 */
function isValidSourceFile(document) {
    const isJavaScript = document.languageId === 'javascript' || 
                        document.languageId === 'typescript';
    const isTestFile = document.fileName.includes('.test.') || 
                      document.fileName.includes('.spec.');
    return isJavaScript && !isTestFile;
}



/**
 * Detect functions in the document
 * @param {vscode.TextDocument} document 
 */
function detectFunctions(document) {
    state.functionRanges.clear();

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const trimmedLine = line.text.trim();
        
        if (!trimmedLine || trimmedLine.startsWith('//') || trimmedLine.startsWith('/*')) {
            continue;
        }

        const match = findFunctionDefinition(line.text);
        if (match) {
            const range = new vscode.Range(i, 0, i, line.text.length);
            state.functionRanges.set(match.name, range);
        }
    }
}

/**
 * Find function definition in a line of code
 * @param {string} text 
 */
function findFunctionDefinition(text) {

    const patterns = [
        /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/,
        /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/,
        /^(?:export\s+)?const\s+(\w+)\s*=\s*function\s*\(/,
        /^(?:export\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*{/
    ];

    // Remove patterns that match inside comments
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            // Additional check to ensure it's not inside a comment
            const commentIndex = text.indexOf('//');
            if (commentIndex === -1 || match.index < commentIndex) {
                return { name: match[1] };
            }
        }
    }
    return null;
}


/**
 * Create decorations array for detected functions
 */
function createDecorations() {
    return Array.from(state.functionRanges.entries()).map(([name, range]) => ({
        range: new vscode.Range(
            range.end.line,
            range.end.character - 1,
            range.end.line,
            range.end.character + 6
        ),
        hoverMessage: `Click to generate test for function "${name}"`,
        renderOptions: {
            after: {
                contentText: '⚡Test',
                margin: '0 0 0 1rem',
                textDecoration: 'none; cursor: pointer !important;'
            }
        }
    }));
}

/**
 * Extract complete function code
 * @param {number} startLine 
 */
function extractFunctionCode(startLine) {
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
 * Handle batch test generation for all functions
 * @param {vscode.TextEditor} editor 
 */
async function handleBatchTestGeneration(editor) {
    if (!editor || state.functionRanges.size < 2) {
        return;
    }

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Generating tests for file...",
            cancellable: false
        }, async (progress) => {
            // Get the entire file content
            const document = editor.document;
            const fileContent = document.getText();
            
            // Get the file name without extension
            const fileName = path.basename(document.fileName, path.extname(document.fileName));

            try {
                // Generate test for the entire file
                progress.report({
                    message: `Generating tests for ${fileName}`,
                    increment: 50
                });

                const testCode = await generateTestCode(fileContent);
                
                progress.report({
                    message: `Creating test file`,
                    increment: 50
                });

                // Create a single test file
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (!workspaceFolder) {
                    throw new Error('No workspace folder found');
                }

                // Create the test folder path
                const testFolderPath = vscode.Uri.joinPath(workspaceFolder.uri, 'codematetest');
                await ensureTestFolderExists(testFolderPath);

                // Create the test file path using the original file name
                const testFilePath = vscode.Uri.joinPath(
                    testFolderPath,
                    `${fileName}.test.js`
                );

                const content = [
                    '// Generated Test File',
                    `// Source File: ${fileName}`,
                    `// Generated: ${new Date().toISOString()}`,
                    '',
                    testCode
                ].join('\n');

                await vscode.workspace.fs.writeFile(testFilePath, Buffer.from(content));
                const testDocument = await vscode.workspace.openTextDocument(testFilePath);
                await vscode.window.showTextDocument(testDocument, { viewColumn: vscode.ViewColumn.Beside });
                
                vscode.window.showInformationMessage(
                    `Generated test file for ${fileName}`
                );
            } catch (error) {
                console.error(`Failed to generate test file:`, error);
                vscode.window.showErrorMessage(`Failed to generate test file: ${error.message}`);
            }
        });
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to generate tests: ${error.message}`);
    }
}

/**
 * Handle test generation command
 * @param {Object} functionInfo 
 * @param {boolean} isCommandExecution 
 */
async function handleTestGeneration(functionInfo, isCommandExecution) {
    // Ensure function info is valid
    if (!functionInfo?.code) {
        // If no function code is provided, try to get the current function
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const position = editor.selection.active;
        for (const [name, range] of state.functionRanges) {
            if (range.contains(position)) {
                functionInfo = {
                    name,
                    range,
                    code: extractFunctionCode(range.start.line)
                };
                break;
            }
        }

        // If still no function found, exit
        if (!functionInfo?.code) {
            return;
        }
    }

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Generating test...",
            cancellable: false
        }, async () => {
            const testCode = await generateTestCode(functionInfo.code);
            await createTestFile(functionInfo.name, testCode);
        });
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to generate test: ${error.message}`);
    }
}

/**
 * Generate test code for a function
 * @param {string} functionCode 
 */
async function generateTestCode(functionCode) {
    const apiUrl = "https://ai-api.amalitech.org/api/v1/public/chat";
    const prompt = `Generate a unit test for this function:\n\n${functionCode}\n put your explanation into comments, 
    infer the javascript convention(es modules or common js) and generate a test for that convention`;
    const modelId = "a58c89f1-f8b6-45dc-9727-d22442c99bc3";

    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "X-API-KEY": "MHzEqNKyVPYftQQgbbxv3y2sruZQ5Swk",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ prompt, stream: false, modelId })
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.statusText}`);
        }

        const data = await response.json();
        return extractTestCode(data.data.content);
    } catch (error) {
        throw new Error(`Test generation failed: ${error.message}`);
    }
}

/**
 * Extract code from API response
 * @param {string} response 
 */
function extractTestCode(response) {
    const codeMatch = response.match(/```javascript\n([\s\S]*?)```/);
    return codeMatch ? codeMatch[1].trim() : response;
}

/**
 * Create test file
 * @param {string} functionName 
 * @param {string} testCode 
 */
async function createTestFile(functionName, testCode) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('No workspace folder found');
    }
    
    try {
        // Create the test folder path
        const testFolderPath = vscode.Uri.joinPath(workspaceFolder.uri, 'codematetest');
        await ensureTestFolderExists(testFolderPath);

        // Create the test file path INSIDE the codematetest folder
        const testFilePath = vscode.Uri.joinPath(
            testFolderPath, 
            `${functionName}.test.js`
        );

        const content = [
            '// Generated Test File',
            `// Function: ${functionName}`,
            `// Generated: ${new Date().toISOString()}`,
            '',
            testCode
        ].join('\n');

        await vscode.workspace.fs.writeFile(testFilePath, Buffer.from(content));
        const document = await vscode.workspace.openTextDocument(testFilePath);
        await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside });
        vscode.window.showInformationMessage(`Test generated for ${functionName} in codematetest folder`);
    } catch (error) {
        if (error.message.includes('Failed to create test directory')) {
            vscode.window.showErrorMessage(`Failed to create codematetest folder: ${error.message}`);
        } else {
            vscode.window.showErrorMessage(`Failed to create test file: ${error.message}`);
        }
        throw error;
    }
}


async function ensureTestFolderExists(folderPath){
    try{
        const stat = await vscode.workspace.fs.stat(folderPath);
        if (stat.type !== vscode.FileType.Directory){
            throw new Error("Path exists but is not a directory");
        }
        return true;
    }catch (error){
        if (error.code== "FileNotFound"){
            try{
                await vscode.workspace.fs.createDirectory(folderPath);
                return true;
            }
            catch(createError){
                throw new Error(`Failed to create test directory: ${createError.message}`);
            }
        }
        throw error;
    }
}


function deactivate() {
    if (state.decorationType) {
        state.decorationType.dispose();
    }
    if (state.batchStatusBarItem) {
        state.batchStatusBarItem.dispose();
    }

    state.functionRanges.clear;
}

module.exports = {
    activate,
    deactivate
};
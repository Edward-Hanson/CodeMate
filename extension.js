const vscode = require('vscode');
const path = require('path');
const escomplex = require('typhonjs-escomplex');


/**
 * Extension state management for CodeMate
 */
const state = {
    activeEditor: null,
    decorationType: null,
    refactorDecorationType: null ,
    batchDecorationType: null,
    functionRanges: new Map(),
    complexityRanges: new Map(),
    lastProcessedVersion: undefined,
    isEditingFunction: false,
    lastClickTime: 0,
    batchStatusBarItem: null,
    lastTypingTime: 0,
    editingTimeout: null,
};

/**
 * Activate the extension
 * @param {vscode.ExtensionContext} context 
 */
function activate(context) {
    state.functionRanges.clear();

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

    state.complexityDecorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(128,128,128,0.05)', 
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

    state.refactorDecorationType = vscode.window.createTextEditorDecorationType({
        gutterIconPath: vscode.Uri.file(path.join(__dirname + "/resources/images", 'refactor-icon.svg')),
        gutterIconSize: 'contain',
        cursor: 'pointer'
    });


    // Register commands
    let disposable = vscode.commands.registerTextEditorCommand(
        'extension.generateTestForFunction',
        (args) => handleTestGeneration(args)
    );

    let batchDisposable = vscode.commands.registerTextEditorCommand(
        'extension.generateTestsForAllFunctions',
        (textEditor) => handleBatchTestGeneration(textEditor)
    );

    let showComplexityDisposable = vscode.commands.registerCommand(
        'extension.showComplexityDashboard',
        () => showComplexityDashboard() 
    );

    let refactorDisposable = vscode.commands.registerTextEditorCommand(
        'extension.handleFunctionRefactoring',
        async (textEditor, edit, functionName) => {
            if (!functionName) {
                // If no function name is provided, try to find the function at the current cursor position
                const position = textEditor.selection.active;
                for (const [name, range] of state.complexityRanges) {
                    if (range.contains(position)) {
                        functionName = name;
                        break;
                    }
                }
            }
            if (!functionName) {
                vscode.window.showErrorMessage("No function selected for refactoring.");
                return;
            }
            await handleFunctionRefactoring(functionName);
        }
    );
    context.subscriptions.push(refactorDisposable);
    context.subscriptions.push(refactorDisposable);
    



    context.subscriptions.push(disposable, batchDisposable, showComplexityDisposable);

    // Register editor event handlers
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(handleEditorChange),
        vscode.workspace.onDidChangeTextDocument(handleDocumentChange),
        vscode.window.onDidChangeTextEditorSelection(handleSelectionChange)
    );

      const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && isValidSourceFile(activeEditor.document)) {
        // Only update decorations, do not generate tests
        state.activeEditor = activeEditor;
        updateDecorations();
        updateBatchButton();
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
     // Only analyze complexity if the document has more than 10 lines
     if (state.activeEditor.document.lineCount > 10) {
        const metrics = analyzeComplexity(state.activeEditor.document);
        highlightComplexFunctions(metrics);
    }

    const position = selection.active;
    const document = state.activeEditor.document;
    const line = document.lineAt(position.line);
    const lineLength = line.text.trim().length;
    const currentTime = Date.now();

    const CLICK_DEBOUNCE_TIME = 2000; 
    const TYPING_COOLDOWN = 2000;

    // Additional check to prevent test generation on empty or whitespace-only lines
    if (line.text.trim() === '') {
        return;
    }

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
    const isDeliberateClick =( position.character == lineLength + 5 || position.character == lineLength + 6 ) &&
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
                handleTestGeneration(functionInfo);
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

      // Only calculate metrics if document has more than 10 lines
      if (document.lineCount > 10) {
        const metrics = analyzeComplexity(document);
        highlightComplexFunctions(metrics);
    } else {
        // Clear complexity decorations if document is too small
        state.activeEditor.setDecorations(state.complexityDecorationType, []);
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
/**
 * Detect functions in the document and add placeholders
 * @param {vscode.TextDocument} document 
 */
function detectFunctions(document) {
    state.functionRanges.clear();

    const edits = [];
    const placeholder = " ".repeat(50); // Example placeholder: 10 spaces

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const trimmedLine = line.text.trim();

        if (!trimmedLine || trimmedLine.startsWith('//') || trimmedLine.startsWith('/*')) {
            continue;
        }

        const match = findFunctionDefinition(line.text);
        if (match) {
            const range = new vscode.Range(i, 0, i, line.text.trim().length);
            state.functionRanges.set(match.name, range);

            // Check if there's enough whitespace at the end of the line
            if (!line.text.endsWith(placeholder)) {
                const edit = vscode.TextEdit.insert(
                    new vscode.Position(i, line.text.length),
                    placeholder
                );
                edits.push(edit);
            }
        }
    }

    if (edits.length > 0) {
        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.set(document.uri, edits);
        vscode.workspace.applyEdit(workspaceEdit);
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
            range.end.character + 4,
            range.end.line,
            range.end.character +5
        ),
        hoverMessage: `Click to generate test for function "${name}"`,
        renderOptions: {
            after: {
                contentText: '⚡Test',
                margin: '0 0rem 0 0rem',
                padding: '0 0rem 0 0rem',
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

                const testCode = await generateBatchTestCode(fileContent);
                
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
 */
async function handleTestGeneration(functionInfo) {
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
    const prompt = `Assume the position of an Expert Software Developer. 
    For the following function, provide:
    1. A comprehensive unit test
    2. A detailed code review with:
       a) Best practices assessment
       b) Performance optimization suggestions
       c) Refactoring recommendations
       d) Adherence to Amalitech Coding standards

    Clearly separate the test code and review comments.
    Provide test code in a code block and review comments in a comment block.
    In the comment section, start with a comment //comment and end with a comment //comment.

    Function to analyze:
    \\\\javascript
    ${functionCode}
    \\\\\`\``;

    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "X-API-KEY": "MHzEqNKyVPYftQQgbbxv3y2sruZQ5Swk",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ prompt, stream: false })
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.statusText}`);
        }

        const data = await response.json();
        return extractTestAndReviewContent(data.data.content);
    } catch (error) {
        throw new Error(`Test generation failed: ${error.message}`);
    }
}


async function generateBatchTestCode(functionCode) {
    const apiUrl = "https://ai-api.amalitech.org/api/v1/public/chat";
    const prompt = `Assume the position of an Expert Software Developer. 
    For the following function, provide:
    1. A comprehensive unit test
    2. A detailed code review with:
       a) Best practices assessment
       b) Performance optimization suggestions
       c) Refactoring recommendations
       d) Adherence to Amalitech Coding standards

    Put all comment in a comments (//), make sure that just the runnable code in not in a comment

    Function to analyze:
    \\\\javascript
    ${functionCode}
    \\\\\`\``;

    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "X-API-KEY": "MHzEqNKyVPYftQQgbbxv3y2sruZQ5Swk",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ prompt, stream: false })
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

function extractTestAndReviewContent(response) {
    const testCodeMatch = response.match(/```javascript\n([\s\S]*?)```/);
    const reviewCommentsMatch = response.match(/\/\/comment([\s\S]*?)\/\/comment/i);

    return {
        testCode: testCodeMatch ? testCodeMatch[1].trim() : 'No test code generated.',
        reviewComments: reviewCommentsMatch ? formatReviewComments(reviewCommentsMatch[1]) : 'No review comments available.'
    };
}

function formatReviewComments(rawComments) {
    // Clean and format the review comments
    const cleanedComments = rawComments
        .split('\n')
        .map(line => line.replace(/^\/\/\s*/, '').trim())
        .filter(line => line.length > 0);

    // Create a formatted review string
    return `Code Review:
${cleanedComments.map(comment => `- ${comment}`).join('\n')}`;
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
async function createTestFile(functionName, content) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('No workspace folder found');
    }
    
    try {
        const testFolderPath = vscode.Uri.joinPath(workspaceFolder.uri, 'codematetest');
        await ensureTestFolderExists(testFolderPath);

        const testFilePath = vscode.Uri.joinPath(
            testFolderPath, 
            `${functionName}.test.js`
        );

        const htmlContent = await generateTestGenerationHTML(functionName, content.testCode, content.reviewComments);
        
        await vscode.workspace.fs.writeFile(testFilePath, Buffer.from(content.testCode));
        
        const htmlPanel = vscode.window.createWebviewPanel(
            'testGenerationView',
            `Test for ${functionName}`,
            vscode.ViewColumn.Beside,
            { enableScripts: true }
        );
        
        htmlPanel.webview.html = htmlContent;
    } catch (error) {
        if (error.message.includes('Failed to create test directory')) {
            vscode.window.showErrorMessage(`Failed to create codematetest folder: ${error.message}`);
        } else {
            vscode.window.showErrorMessage(`Failed to create test file: ${error.message}`);
        }
        throw error;
    }
}

async function generateTestGenerationHTML(functionName, testCode, reviewComments) {
    // You can use the HTML from the artifact, replacing placeholders dynamically
    const htmlTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Code Analysis Report</title>
    <style>
        :root {
            --primary-bg: #ffffff;
            --secondary-bg: #f8f9fa;
            --text-primary: #1a1a2e;
            --text-secondary: #4a4a68;
            --accent-color: #3498db;
            --border-light: #e0e4e8;
            --shadow-subtle: 0 4px 6px rgba(0,0,0,0.05);
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            background-color: var(--secondary-bg);
            color: var(--text-primary);
            font-weight: 400;
        }

        .container {
            width: 100%;
            max-width: 1000px;
            margin: 0 auto;
            padding: 2rem;
        }

        .section {
            background-color: var(--primary-bg);
            border-radius: 12px;
            box-shadow: var(--shadow-subtle);
            margin-bottom: 1.5rem;
            overflow: hidden;
            border: 1px solid var(--border-light);
        }

        .section-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem 1.5rem;
            background-color: var(--secondary-bg);
            border-bottom: 1px solid var(--border-light);
        }

        .section-header h2 {
            font-size: 1.2rem;
            color: var(--text-primary);
            font-weight: 600;
            margin: 0;
        }

        .button-group {
            display: flex;
            gap: 0.5rem;
        }

        .btn {
            border: none;
            border-radius: 6px;
            padding: 0.5rem 1rem;
            font-size: 0.9rem;
            cursor: pointer;
            transition: background-color 0.2s ease;
            font-weight: 500;
        }

        .toggle-btn {
            background-color: var(--accent-color);
            color: white;
        }

        .copy-btn {
            background-color: #2ecc71;
            color: white;
        }

        .btn:hover {
            opacity: 0.9;
        }

        .section-content {
            display: none;
            max-height: 500px;
            overflow-y: auto;
            padding: 1.5rem;
            font-size: 0.95rem;
            line-height: 1.7;
        }

        .section-content.active {
            display: block;
        }

        pre {
            background-color: var(--secondary-bg);
            border-radius: 8px;
            padding: 1.2rem;
            white-space: pre-wrap;
            word-wrap: break-word;
            font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
            font-size: 0.9rem;
            color: var(--text-secondary);
            border: 1px solid var(--border-light);
            overflow-x: auto;
        }

        .test-code {
            background-color: #f0f4f8;
        }

        .review-comments {
            background-color: #f7f3f0;
        }

        @media (max-width: 768px) {
            .container {
                padding: 1rem;
            }
            .section-header {
                flex-direction: column;
                align-items: flex-start;
                gap: 0.5rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="section">
            <div class="section-header">
                <h2>Generated Test Code</h2>
                <div class="button-group">
                    <button class="btn toggle-btn" onclick="toggleSection('test-code')">Toggle View</button>
                    <button class="btn copy-btn" onclick="copyContent('test-code')">Copy Code</button>
                </div>
            </div>
            <pre id="test-code" class="section-content test-code">
${testCode}
            </pre>
        </div>

        <div class="section">
            <div class="section-header">
                <h2>Code Review Comments</h2>
                <div class="button-group">
                    <button class="btn toggle-btn" onclick="toggleSection('review-comments')">Toggle View</button>
                    <button class="btn copy-btn" onclick="copyContent('review-comments')">Copy Comments</button>
                </div>
            </div>
            <pre id="review-comments" class="section-content review-comments">
${reviewComments}
            </pre>
        </div>
    </div>

    <script>
        function toggleSection(sectionId) {
            const section = document.getElementById(sectionId);
            section.classList.toggle('active');
        }

        function copyContent(sectionId) {
            const content = document.getElementById(sectionId);
            const textArea = document.createElement('textarea');
            textArea.value = content.textContent.trim();
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            
            // Custom toast notification
            const toast = document.createElement('div');
            toast.textContent = 'Copied to clipboard!';
            toast.style.position = 'fixed';
            toast.style.bottom = '20px';
            toast.style.right = '20px';
            toast.style.backgroundColor = 'rgba(0,0,0,0.7)';
            toast.style.color = 'white';
            toast.style.padding = '10px 15px';
            toast.style.borderRadius = '4px';
            toast.style.zIndex = '1000';
            document.body.appendChild(toast);
            
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 2000);
        }
    </script>
</body>
</html>`; // Use the HTML from the artifact above
    
    return htmlTemplate
        .replace('${functionName}', functionName)
        .replace('${testCode}', testCode)
        .replace('${reviewComments}', reviewComments);
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
      //vscode.window.showErrorMessage(`Complexity analysis failed: ${error.message}`);
      console.error(error);
      return null;
    }
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



async function generateDashboardHTML(){
    const document = vscode.window.activeTextEditor?.document;
    if (!document){
        return '<h1>No Active File</h1><p>Please open a file to analyze complexity.</p>';
    }

    const metrics = analyzeComplexity(document);
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

// Update the showComplexityDashboard function to handle webview messages
async function showComplexityDashboard(){
    if (!state.activeEditor || state.activeEditor.document.lineCount <= 1){
        vscode.window.showErrorMessage("Editor is Empty or No Active Editor");
        return;
    }

    // Store the current document's contents and file path instead of URI
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

    // Generate HTML content
    panel.webview.html = await generateDashboardHTML();

    // Handle messages from the webview
    panel.webview.onDidReceiveMessage(
        async (message) => {
            console.log('Message received from webview:', message);
            switch (message.command) {
                case 'refactor':
                    // Find the correct editor by matching file path and content
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
                            await handleFunctionRefactoring(message.functionName);
                        } catch (error) {
                            vscode.window.showErrorMessage(`Cannot find or open the original document: ${error.message}`);
                        }
                        return;
                    }

                    // Use the first matching editor
                    const targetEditor = matchingEditors[0];
                    
                    console.log(`Refactoring function: ${message.functionName}`);
                    state.activeEditor = targetEditor;
                    await handleFunctionRefactoring(message.functionName);
                    break;
            }
        },
        undefined,
    );
}

/**
 * Highlights functions in the editor based on their complexity.
 * @param {Array} metrics - List of function metrics containing name, complexity, and line ranges.
 */
function highlightComplexFunctions(metrics) {
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


/**
 * Handle refactoring for a high-complexity function
 * @param {string} functionName 
 */
async function handleFunctionRefactoring(functionName) {
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
            const functionCode = extractFunctionCode(functionRange.start.line);
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


/**
 * Extract refactored code from API response
 * @param {string} response 
 */
function extractRefactoredCode(response) {
    const codeMatch = response.match(/```javascript\n([\s\S]*?)```/);
    return codeMatch ? codeMatch[1].trim() : response.trim();
}



function deactivate() {
    if (state.decorationType) {
        state.decorationType.dispose();
    }
    if (state.complexityDecorationType) {
        state.complexityDecorationType.dispose();
    }
    if (state.batchStatusBarItem) {
        state.batchStatusBarItem.dispose();
    }

    state.functionRanges.clear();
}

module.exports = {
    activate,
    deactivate
};

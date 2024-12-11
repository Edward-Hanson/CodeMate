const vscode = require('vscode');
const path = require('path');


/**
 * Handle batch test generation for all functions
 * @param {vscode.TextEditor} editor 
 */
async function handleBatchTestGeneration(state, editor) {
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

/**
 * Extract code from API response
 * @param {string} response 
 */
function extractTestCode(response) {
    const codeMatch = response.match(/```javascript\n([\s\S]*?)```/);
    return codeMatch ? codeMatch[1].trim() : response;
}






/**
 * Handle test generation command
 * @param {Object} functionInfo 
 */
async function handleTestGeneration(state, functionInfo) {
    console.log("Code: " , functionInfo.code);
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
                    code: extractFunctionCode(state, range.start.line)
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
 * Extract complete function code
 * @param {number} startLine 
 */
function extractFunctionCode(state, startLine) {
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
 * Create test file
 * @param {string} functionName 
 * @param {Object} content 
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

module.exports = { handleBatchTestGeneration, handleTestGeneration };


const { throws } = require('assert');
const vscode = require('vscode');

const errorHandler = require('./errorHandle');

const diagnosticSeverity = {
  0: vscode.DiagnosticSeverity.Information,
  10: vscode.DiagnosticSeverity.Information,
  20: vscode.DiagnosticSeverity.Warning,
  30: vscode.DiagnosticSeverity.Error,
  40: vscode.DiagnosticSeverity.Error,
  50: vscode.DiagnosticSeverity.Error
}

/** @type {vscode.DiagnosticCollection} */
var ileDiagnostics;

module.exports = class CompileTools {

  /**
   * @param {vscode.ExtensionContext} context
   */
  static register(context) {
    ileDiagnostics = vscode.languages.createDiagnosticCollection("ILE");
    context.subscriptions.push(ileDiagnostics);
  }
  
  /**
   * @param {*} instance
   * @param {vscode.TextDocument} document 
   * @param {{lib: string, object: string, ext?: string}} evfeventInfo
   */
  static async refreshDiagnostics(instance, document, evfeventInfo) {
    const content = instance.getContent();

    const tableData = await content.getTable(evfeventInfo.lib, 'EVFEVENT', evfeventInfo.object);
    const lines = tableData.map(row => row.EVFEVENT);

    const errors = errorHandler(lines);

    /** @type {vscode.Diagnostic[]} */
    var diagnostics = [];

    /** @type {vscode.Diagnostic} */
    var diagnostic;

    for (const file in errors) {
      diagnostics = [];
      
      for (const error of errors[file]) {

        error.column = Math.max(error.column-1, 0);
        error.linenum = Math.max(error.linenum-1, 0);

        if (error.column === 0 && error.toColumn === 0) {
          error.column = 0;
          error.toColumn = 100;
        }
        
        diagnostic = new vscode.Diagnostic(
          new vscode.Range(error.linenum, error.column, error.linenum, error.toColumn),
          `${error.code}: ${error.text}`,
          diagnosticSeverity[error.sev]
        );

        diagnostics.push(diagnostic);
      }

      ileDiagnostics.set(vscode.Uri.parse(`member:/${file}${evfeventInfo.ext ? '.' + evfeventInfo.ext : ''}`), diagnostics);
    }


  }

  /**
   * @param {*} instance
   * @param {vscode.TextDocument} document 
   */
  static async Compile(instance, document) {
    var evfeventInfo = {lib: '', object: ''};

    const uri = document.uri;
    const config = vscode.workspace.getConfiguration('code-for-ibmi');
    const compileCommands = config.get('compileCommands');

    const extension = uri.path.substring(uri.path.lastIndexOf('.')+1);

    const compileOptions = compileCommands.filter(item => item.fileSystem === uri.scheme && item.extension === extension);

    if (compileOptions.length > 0) {
      const options = compileOptions.map(item => item.name);

      var chosenOptionName, command;

      if (options.length === 1) {
        chosenOptionName = options[0]
      } else {
        chosenOptionName = await vscode.window.showQuickPick(options);
      }

      if (chosenOptionName) {
        command = compileCommands.find(item => item.fileSystem === uri.scheme && item.extension === extension && item.name === chosenOptionName).command;

        switch (uri.scheme) {
          case 'member':
            const [blank, lib, file, fullName] = uri.path.split('/');
            const name = fullName.substring(0, fullName.lastIndexOf('.'));

            var ext = (fullName.includes('.') ? fullName.substring(fullName.lastIndexOf('.') + 1) : undefined)

            evfeventInfo = {
              lib: lib,
              object: name,
              ext: ext
            };

            command = command.replace(new RegExp('&OPENLIB', 'g'), lib);
            command = command.replace(new RegExp('&OPENSPF', 'g'), file);
            command = command.replace(new RegExp('&OPENMBR', 'g'), name);

            break;
        }

        command = `system -s "${command}"`;

        const connection = instance.getConnection();
        const libl = connection.libraryList.slice(0).reverse();

        var output, compiled = false;

        try {
          output = await connection.qshCommand([
            'liblist -d ' + connection.defaultUserLibraries.join(' '),
            'liblist -a ' + libl.join(' '),
            command,
          ]);

          compiled = true;
          vscode.window.showInformationMessage(`Compiled ${evfeventInfo.lib}/${evfeventInfo.object} successfully!`);
        } catch (e) {
          output = e;
          compiled = false;

          vscode.window.showErrorMessage(`${evfeventInfo.lib}/${evfeventInfo.object} did not compile.`);
        }

        console.log({compiled, output});

        if (command.includes('*EVENTF')) {
          this.refreshDiagnostics(instance, document, evfeventInfo);
        }
      }

    } else {
      //No compile commands
      vscode.window.showErrorMessage(`No compile commands found for ${uri.scheme}-${extension}.`);
    }
  }
}
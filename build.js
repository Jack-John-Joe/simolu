// This is a super simple script for `npm run build` that creates a `dist-package.json` file based on the `package.json` file.
// Since it's not supposed to be in `dist`, it's not a TypeScript file to build and is just a plain JS file. It works cross-platform.

import fs from 'fs';
import * as url from "url";
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = url.fileURLToPath(new URL(".", import.meta.url));
import path from 'path';

import chalk from 'chalk';

// import child_process
import { exec } from 'child_process';

const packageJson = JSON.parse(fs.readFileSync(__dirname + '/package.json', 'utf8'));

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}
console.log(chalk.bold('Building ' + capitalizeFirstLetter(packageJson.name) + ' v' + packageJson.version + '...\n'));

var steps = [
    // remove dist folder
    async (stepInfo) => {
        // first, remove dist folder
        const distPath = path.join(__dirname, 'dist');
        if (fs.existsSync(distPath)) {
            console.log(stepInfo, 'Clearing previous build...');
            fs.rmSync(distPath, { recursive: true });
        }
        else {
            console.log(stepInfo, 'No previous build');
        }
    },
    // run tsc
    async (stepInfo) => {
        console.log(stepInfo, 'Compiling TypeScript...');
        return new Promise((resolve, reject) => {
            exec('tsc', (err, stdout, stderr) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(stdout);
                }
            });
        });
    },
    // make dist/client folder if doesnt exist
    async (stepInfo) => {
        if (!fs.existsSync(path.join(__dirname, 'dist', 'client'))) {
            console.log(stepInfo, 'Creating dist/client folder...');
            fs.mkdirSync(path.join(__dirname, 'dist', 'client'));
        }
        else {
            console.log(stepInfo, 'dist/client folder already exists');
        }
    },
    // generate distPackage
    async (stepInfo) => {
        console.log(stepInfo, 'Creating dist-package.json...');
        // create a `dist-package.json` file
        var distPackage = {
            name: packageJson.name,
            version: packageJson.version,
            main: 'server/src/index.js',
            scripts: {
                start: 'node server/src/index.js',
                build: 'echo "This is a build, run this on the source" && exit 1' // for convenience since people will likely accidentally run this
            },
            dependencies: packageJson.dependencies,
            engines: packageJson.engines,
            type: packageJson.type
        };
        // write to dist/package.json with 4 spaces
        fs.writeFileSync(path.join(__dirname, 'dist', 'package.json'), JSON.stringify(distPackage, null, 4));
    },
    // recursively copy client/assets to dist/client/assets, client/icons to dist/client/icons, client/index.css and client/index.html to dist/client and media to dist/media. finally, node_modules to dist/node_modules and client/src to dist/client/src
    async (stepInfo) => {
        // we'll do above in separate steps
        console.log(stepInfo, 'Copying client/assets to dist/client/assets...');
        copyFolderRecursiveSync(path.join(__dirname, 'client', 'assets'), path.join(__dirname, 'dist', 'client', 'assets'));
    },
    async (stepInfo) => {
        console.log(stepInfo, 'Copying client/icons to dist/client/icons...');
        copyFolderRecursiveSync(path.join(__dirname, 'client', 'icons'), path.join(__dirname, 'dist', 'client', 'icons'));
    },
    async (stepInfo) => {
        console.log(stepInfo, 'Copying client/index.css to dist/client...');
        fs.copyFileSync(path.join(__dirname, 'client', 'index.css'), path.join(__dirname, 'dist', 'client', 'index.css'));
    },
    async (stepInfo) => {
        console.log(stepInfo, 'Copying client/index.html to dist/client...');
        fs.copyFileSync(path.join(__dirname, 'client', 'index.html'), path.join(__dirname, 'dist', 'client', 'index.html'));
    },
    async (stepInfo) => {
        console.log(stepInfo, 'Copying media to dist/media...');
        copyFolderRecursiveSync(path.join(__dirname, 'media'), path.join(__dirname, 'dist', 'media'));
    },
    async (stepInfo) => {
        console.log(stepInfo, 'Copying node_modules to dist/node_modules...');
        copyFolderRecursiveSync(path.join(__dirname, 'node_modules'), path.join(__dirname, 'dist', 'node_modules'));
    },
    async (stepInfo) => {
        console.log(stepInfo, 'Copying client/src to dist/client/src...');
        copyFolderRecursiveSync(path.join(__dirname, 'client', 'src'), path.join(__dirname, 'dist', 'client', 'src'));
    }
];

function copyFolderRecursiveSync(source, target) {
    var files = [];
    // check if folder needs to be created or integrated
    var targetFolder = target;
    if (!fs.existsSync(targetFolder)) {
        fs.mkdirSync(targetFolder);
    }
    // copy
    if (fs.lstatSync(source).isDirectory()) {
        files = fs.readdirSync(source);
        files.forEach(function (file) {
            var curSource = path.join(source, file);
            if (fs.lstatSync(curSource).isDirectory()) {
                copyFolderRecursiveSync(curSource, path.join(targetFolder, path.basename(curSource)));
            }
            else {
                fs.copyFileSync(curSource, path.join(targetFolder, path.basename(curSource)));
            }
        });
    }
}

// run steps
for (var i = 0; i < steps.length; i++) {
    await steps[i]((i + 1) + '/' + steps.length);
}


console.log(chalk.greenBright.bold('\nBuild complete!'));
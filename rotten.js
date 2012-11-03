#!/usr/bin/env node
var path = require('path');
var exec = require('child_process').exec;
var async = require('async');
var colors = require('colors');
var optimist =
    require('optimist')
        .alias('h', 'help')

        .alias('r', 'repo')
        .default('r', process.cwd())
        .describe('r', 'the repo you\'d like to examine for rotting code')

        .alias('p', 'prod')
        .default('p', 'master')
        .describe('p', 'the branch you have running in production')

        .alias('c', 'mostcommits')
        .default('c', false)
        .describe('c', 'show branches with the most commits first (defaults to showing oldest commits first)')

        .usage('Usage: $0 --repo /path-to-git-repo --prod master')
        ;

var help = optimist.help();
var argv = optimist.argv;
if (argv.help) {
    console.log(help);
    return;
}

var repoDir = path.resolve(__dirname, argv.repo);
var prod = argv.prod;

function git(args, cb) {
    // args = '--git-dir ' + repoDir + '/.git ' + args;
    // console.log('git ' + args);
    // return exec([ 'git', args ], cb)
    return exec('git ' + args, { cwd: repoDir }, cb);
}
function trim (s) { return s.trim(); }
function identity (s) { return s; }

function spacepad(input, padto) {
    var out = '' + input;
    while (out.length < padto)
        out = ' ' + out;
    return out;
}

function handleError(err) {
    if (/spawn Unknown system errno 23/.test(err.message)) {
        console.log('\n', new Error(err.message).stack);
        console.log('ERROR. Please be sure you\'ve specified a branch that exists.\nI have' +
            ' reason to believe that the branch ' + prod.red +' does not exist in' +
            ' this repo.');
    } else {
        console.log('Please report bugs to https://github.com/dtrejo/rotten, thank you.');
    }
}

function main () {
    console.log('Running against', repoDir.green);
    console.log('Checking that branches are in production branch', prod.green);
    git('branch -r', function (err, stdout, stderr) {
        if (err) handleError(new Error(err.message).stack);

        var branches = stdout.split('\n').map(trim).filter(identity);
        var inprod = [];
        var notinprod = [];
        var partiallyinprod = [];

        var prodRegex = new RegExp('/' + prod + '$');
        var dot = 0;
        async.forEach(branches, function (branch, cb) {
            if (prodRegex.test(branch))
                return cb(); // ignore e.g. origin/master
            if (dot++ % 5 === 0)
                process.stdout.write('.');
            // git log dt-bsr --not --remotes="*/release" --format="%H | %ae | %ce | %ar | %cr | %ct"
            git('log ' + branch + ' --not --remotes="*/' + prod + '" --format="%H | %ae | %ce | %ar | %cr | %ct"', function (err, stdout, stderr) {
                if (err)
                    console.log('\n', new Error(err.message).stack);

                var commits = stdout.split('\n').map(trim).filter(identity).map(function (s) {
                    var fields = s.split(' | ');
                    return {
                        sha: fields[0]
                    , author: fields[1]
                    , committer: fields[2]
                    , authordateago: fields[3]
                    , committerdateago: fields[4]
                    , committertimestamp: fields[5] // unix timestamp
                    };
                });
                if (commits.length === 0) {
                    inprod.push({ branch: branch, commits: commits });
                } else {
                    notinprod.push({ branch: branch, commits: commits });
                }
                cb();
            });
        }, function (err) {
            if (err)
                handleError(new Error(err.message).stack);

            console.log('');
            if (inprod.length) {
                inprod = inprod.reverse();
                console.log('---\nBranches in prod that can be deleted:');
                inprod.forEach(function (info) {
                    console.log('    ' + info.branch.green);
                });
                console.log();
                console.log("==Paste the following to delete them all==".red);
                var deleteThese =
                    inprod.map(function (info) {
                        var branchName = info.branch.replace(/(.*\/)/, ''); // take everything after the slash
                        return 'git push origin :' + branchName.red + '; git branch -D ' + branchName.red + ';';
                    })
                    .join('\n');
                console.log(deleteThese);
                console.log();
                console.log();
            } else {
                console.log('==Congrats, repo is clean of branches already merged into '.green + prod.magenta + '=='.green);
            }
            if (notinprod.length) {
                console.log('==Branches waiting to get into prod (or plain rotten). Most oldest/most commits first=='.red);
                if (argv.mostcommits) {
                    notinprod.sort(function (a, b) {
                        return b.commits.length - a.commits.length;
                    });
                } else {
                    // oldest first
                    notinprod.sort(function (a, b) {
                        return a.commits[0].committertimestamp - b.commits[0].committertimestamp;
                    });
                }

                notinprod.forEach(function (info) {
                    var latest = info.commits[0];
                    var message = '    ';
                    message += spacepad(info.commits.length, 5);
                    message += '    ' + info.branch.red;
                    console.log(message + '    updated %s / committer %s, %s.'
                        , latest.authordateago, latest.committer.green, latest.committerdateago);
                });
            } else {
                console.log('==Congrats, repo has no remote branches waiting to get into '.green + prod.magenta + '. You are a superstar=='.green);
            }

            console.log('');
            console.log('Explanation: rotten = # branches you need to merge into prod');
            console.log('harvested: branches already in prod that need to be deleted.');
            console.log('Please tweet your score! (With the #rotten hashtag :)');
            console.log('    Your rotten score is ' +
                ('#rotten:' + notinprod.length+'/harvested:'+inprod.length).green);
            process.exit(0);
        });
    });
}

process.on('uncaughtException', function (err) {
    if (err)
        handleError(new Error(err.message).stack);
    process.exit(1);
});

if (require.main === module) {
    main();
}

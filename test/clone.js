/**
 * Clones several projects that are known to follow "JavaScript Standard Style" and runs
 * the `standard` style checker to verify that it passes without warnings. This helps
 * ensure we don't accidentally introduce new style rules that cause previously "good"
 * code to start failing with new warnings! (And if we do, then that needs to be a MAJOR
 * VERSION BUMP.)
 */

var crossSpawn = require('cross-spawn')
var fs = require('fs')
var minimist = require('minimist')
var mkdirp = require('mkdirp')
var os = require('os')
var parallelLimit = require('run-parallel-limit')
var path = require('path')
var standardPackages = require('standard-packages')
var test = require('tape')

var GIT = 'git'
var STANDARD = path.join(__dirname, '..', 'bin', 'cmd.js')
var TMP = path.join(__dirname, '..', 'tmp')
var PARALLEL_LIMIT = Math.max(os.cpus().length - 1, 1)

var argv = minimist(process.argv.slice(2), {
  boolean: [
    'disabled',
    'offline',
    'quick',
    'quiet',
    'fix'
  ]
})

var testPackages = argv.quick
  ? standardPackages.test.slice(0, 20)
  : standardPackages.test

var disabledPackages = []
testPackages = testPackages.filter(function (pkg) {
  if (pkg.disable) disabledPackages.push(pkg)
  return !pkg.disable
})

if (argv.disabled) {
  testPackages = disabledPackages
} else {
  test('Disabled Packages', function (t) {
    disabledPackages.forEach(function (pkg) {
      console.log('DISABLED: ' + pkg.name + ': ' + pkg.disable + ' (' + pkg.repo + ')')
    })
    t.end()
  })
}

test('test github repos that use `standard`', function (t) {
  t.plan(testPackages.length)

  mkdirp.sync(TMP)

  parallelLimit(testPackages.map(function (pkg) {
    var name = pkg.name
    var url = pkg.repo + '.git'
    var folder = path.join(TMP, name)
    return function (cb) {
      fs.access(path.join(TMP, name), fs.R_OK | fs.W_OK, function (err) {
        if (argv.offline && err) {
          t.pass('SKIPPING (offline): ' + name + ' (' + pkg.repo + ')')
          cb(null)
        } else if (argv.offline) {
          runStandard(cb)
        } else {
          var downloadPackage = err ? gitClone : gitPull
          downloadPackage(function (err) {
            if (err) return cb(err)
            runStandard(cb)
          })
        }

        function gitClone (cb) {
          var args = ['clone', '--depth', 1, url, path.join(TMP, name)]
          spawn(GIT, args, { stdio: 'ignore' }, function (err) {
            if (err) err.message += ' (git clone) (' + name + ')'
            cb(err)
          })
        }

        function gitPull (cb) {
          var args = ['pull']
          spawn(GIT, args, { cwd: folder, stdio: 'ignore' }, function (err) {
            if (err) err.message += ' (git pull) (' + name + ')'
            cb(err)
          })
        }

        function runStandard (cb) {
          var args = ['--verbose']
          if (pkg.args) args.push.apply(args, pkg.args)
          spawn(STANDARD, args, { cwd: folder }, function (err) {
            var str = name + ' (' + pkg.repo + ')'
            if (err && argv.fix) {
              t.comment('Attempting --fix on ' + str)
              runStandardFix(cb)
            } else if (err) {
              t.fail(str)
              cb(null)
            } else {
              t.pass(str)
              cb(null)
            }
          })
        }

        function runStandardFix (cb) {
          var args = ['--fix', '--verbose']
          if (pkg.args) args.push.apply(args, pkg.args)
          spawn(STANDARD, args, { cwd: folder }, function (err) {
            var str = name + ' (' + pkg.repo + ') ** with --fix'
            if (err) { t.fail(str) } else { t.pass(str) }
            runGitReset(cb)
          })
        }

        function runGitReset (cb) {
          var args = ['reset', '--hard']
          spawn(GIT, args, { cwd: folder }, function (err) {
            if (err) err.message += ' (git reset) (' + name + ')'
            // Fatal error if can't git reset
            cb(err)
          })
        }
      })
    }
  }), PARALLEL_LIMIT, function (err) {
    if (err) throw err
  })
})

function spawn (command, args, opts, cb) {
  if (!opts.stdio) opts.stdio = argv.quiet ? 'ignore' : 'inherit'

  var child = crossSpawn(command, args, opts)
  child.on('error', cb)
  child.on('close', function (code) {
    if (code !== 0) return cb(new Error('non-zero exit code: ' + code))
    cb(null)
  })
  return child
}

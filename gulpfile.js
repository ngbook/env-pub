/**
 * 功能：
 *  把资源文件上传 CDN
 *  如果没有发布目录，会做相应的初始化
 *  替换 CDN 相关的资源地址
 *  自动提交编译结果
 * 使用：
 *  测试环境：gulp test
 *  qa环境：gulp qa
 *  预发布环境：gulp stg
 *  生产环境：gulp prod
 */
const gulp = require('gulp');
const qiniu = require('gulp-qiniu');
const replace = require('gulp-replace');
const gulpSequence = require('gulp-sequence');
const exec = require('child_process').exec;
const execSync = require('child_process').execSync;
const config = require('./config.json');
const colors = require('colors');
const path = require('path');
const del = require('del');
const readline = require('readline');
const fs = require('fs');
// 用于获取参数的插件
const argv = require('yargs').argv;

let type = process.argv[2]; // 取 gulp 命令后的下一个参数
let newConf = {};
let version; // 总版本号
let assetsPrefix; // assets 的版本路径，如 .../v1.0.0/...

// 所有可用的环境
const envs = ['test', 'stg', 'prod', 'qa'];
// 发布目录
const publishDir = path.resolve(__dirname, 'publish');
// 初始化
(function() {
    // 拆分如 prod:upload 这类的参数
    if (type.indexOf(':') > -1) {
        type = type.split(':')[0];
        if (config[type] === undefined) {
            type = 'test';
            console.log('未指定相关的环境参数，将采用默认 test 环境');
        }
    }
    // 如果没取到环境，默认使用 test
    if (envs.indexOf(type) < 0) {
        type = 'test';
    }
    console.log('环境: ' + type);

    // 设置配置项
    Object.assign(newConf, config['common'] || {},
        config[type] || {});

    // 初始化 version
    version = config.v;
    if (!version) {
        let now = new Date();
        version = Math.round(now.getTime() / 1000 / 60);
    }

    // 设置 assets 路径
    assetsPrefix = newConf.cdnUrl + newConf.uploadPath;
    // 取得 assets 的版本路径
    const ignoreAssets = newConf.ignorePaths
        && newConf.ignorePaths.assets;
    if (ignoreAssets) {
        assetsPrefix += ignoreAssets + '/';
    } else {
        assetsPrefix += version + '/';
    }

})();
console.log('当前环境配置：', newConf);

// 初始化设置发布目录
gulp.task('init-pub', function() {
    try { // 查看发布目录是否存在
        fs.accessSync(publishDir, fs.F_OK);
        console.log('Good! publish 发布目录存在！');
    } catch(e) { // 发布目录不存在
        // 取得发布用的 git 地址
        let gitUrl;
        if (argv.git) {
            gitUrl = argv.git;
            console.log("publish git url：", gitUrl);
        } else {
            console.error(colors.red('请添加用于存放发布代码的 git 地址，格式如：gulp init-pub --git <git-url>'));
            process.exit(1);
        }
        console.error('publish 发布目录不存在，即将初始化...');
        // 创建发布目录
        fs.mkdirSync(publishDir, 0o755);
        // 初始化发布目录的 git 地址
        let cmd = 'cd ' + publishDir
            + ' && git init && git remote add origin ' + gitUrl;
        console.log('初始化 publish 目录完成');
        // console.log(cmd);
        execSync(cmd);
        try { // 尝试取这个分支的最新代码
            execSync('cd ' + publishDir
                + ' && git fetch origin ' + type);
        } catch(ex) { // 线上目前没有这个分支
            // 创建新分支，并默认添加一个 README.md
            cmd = 'cd ' + publishDir
                + ' && git checkout -b ' + type
                + ' && wget https://github.com/ngbook/pub-tpl/archive/master.zip'
                + ' && git add README.md && git commit -m "first commit"'
                + ' && git push origin ' + type;
            console.log('创建新分支...', type);
            // console.log(cmd);
            execSync(cmd);
        }
    }
});

// 相关资源的路径
const PATHS = {
    dist_files: ['./dist/*.html', './src/favicon.ico']
};

/*
  上传 js 等七牛
*/
gulp.task('upload', function () {
    return gulp.src(publishDir + '/www/**')
        .pipe(qiniu({
            accessKey: newConf.ak,
            secretKey: newConf.sk,
            bucket: newConf.bk,
            private: false
        }, {
            dir: newConf.uploadPath + version + '/',
            versioning: false,
            versionFile: '',
            ignore: newConf.uploadIgnore || ['*.html'],
            concurrent: 10
        }));
});

// 分环境上传
gulp.task('test:upload', ['upload']);
gulp.task('stg:upload', ['upload']);
gulp.task('prod:upload', ['upload']);
gulp.task('qa:upload', ['upload']);

/*
上传资源
*/
gulp.task('upload-assets', function () {
    return gulp.src('./src/assets/**')
        .pipe(qiniu({
            accessKey: newConf.ak,
            secretKey: newConf.sk,
            bucket: newConf.bk,
            private: false
        }, {
            dir: newConf.uploadPath + newConf.ignorePaths.assets + '/assets/',
            versioning: false,
            versionFile: '',
            concurrent: 10
        }));
});

gulp.task('test:upload-assets', ['upload-assets']);
gulp.task('stg:upload-assets', ['upload-assets']);
gulp.task('prod:upload-assets', ['upload-assets']);
gulp.task('qa:upload-assets', ['upload-assets']);

// 替换静态资源地址
const pathPrefix = newConf.cdnUrl + newConf.uploadPath + version + '/';
gulp.task('replaceHtml', function () {
    return gulp.src('./dist/*.html')
        // 替换 assets 资源
        .pipe(replace('/assets/', assetsPrefix + 'assets/'))
        // 替换 css 资源
        .pipe(replace('<link href="', '<link href="' + pathPrefix))
        // 替换 js 资源
        .pipe(replace('<script type="text/javascript" src="', '<script type="text/javascript" src="' + pathPrefix))
        // 替换 base
        .pipe(replace('<base href="/">',
            '<base href="' + newConf.htmlBasePath + '">'))
        .pipe(gulp.dest(publishDir + '/www'));
});
// 替换资源文件的路径
gulp.task('replace-assets', function () {
    return gulp.src('./dist/*.js')
        // 替换双引号里的 assets 引用
        .pipe(replace('"/assets/', '"' + assetsPrefix + 'assets/'))
        // 替换单引号里的 assets 引用
        .pipe(replace('\'/assets/', '\'' + assetsPrefix + 'assets/'))
        // 替换背景图里的资源路径
        .pipe(replace('url(/assets/', 'url(' + assetsPrefix + 'assets/'))
        .pipe(gulp.dest(publishDir + '/www'));
});
gulp.task('replace', gulpSequence('replace-assets', 'replaceHtml'));

// 发布目录中，自动切换到相应的分支并更新代码
gulp.task('auto-git-checkout', function (callback) {
    if (envs.indexOf(type) >= 0) {
        const cmd = 'git checkout ' + type + ' && git pull origin ' + type;
        exec(cmd, {
            cwd: publishDir
        }, function (error, stdout, stderr) {
            if (error) {
                console.log(colors.red.underline(error));
            } else {
                console.log(colors.yellow.underline('当前分支:' + type));
                callback();
            }
        });
    } else {
        console.log(colors.red.underline('参数错误'));
    }
});

// 自动 git 提交本次编译的更新
gulp.task('auto-git-commit', function (callback) {
    if (envs.indexOf(type) >= 0) {
        const cmd = 'git add --all && git commit -m "auto-'
            + type + '-commit-' + version + '" '
            + '&& git push origin ' + type
        exec(cmd, {
            cwd: publishDir
        }, function (error, stdout, stderr) {
            if (error) {
                console.log(colors.red.underline(error));
            } else {
                console.log(colors.green('提交成功'));
                callback()
            }
        })
    } else {
        console.log(colors.red.underline('参数错误'));
    }
});

// 运行各个环境的发布操作
gulp.task('test', gulpSequence('init-pub', 'auto-git-checkout', 'replace', 'auto-git-commit', 'test:upload'));
gulp.task('stg', gulpSequence('init-pub', 'auto-git-checkout', 'replace', 'auto-git-commit', 'stg:upload'));
gulp.task('prod', gulpSequence('init-pub', 'auto-git-checkout', 'replace', 'auto-git-commit', 'prod:upload'));
gulp.task('qa', gulpSequence('init-pub', 'auto-git-checkout', 'replace', 'auto-git-commit', 'qa:upload'));
// (以上把 upload 放到最后，是因为七牛的上传是异步的，gulpSequence 会误认为 upload 执行失败)

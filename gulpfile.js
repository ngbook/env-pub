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
const execSync = require('child_process').execSync;
const config = require('./config.json');
const colors = require('colors');
const path = require('path');
const del = require('del');
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
    if (type && type.indexOf(':') > -1) {
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
    console.log(colors.red('VERSION: ' + version));

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

function exeCmd(cmd, opts) {
    let options = null;
    if (!opts || !opts.inCurDir) {
        options = {
            cwd: publishDir
        };
    }
    const result = execSync(cmd, options);
}

// 初始化设置发布目录
gulp.task('init-pub', function(callback) {
    try { // 查看发布目录是否存在
        fs.accessSync(publishDir, fs.F_OK);
        console.log('Good! publish 发布目录存在！');
    } catch(e) { // 发布目录不存在
        console.log(colors.yellow('publish 发布目录不存在，即将初始化...'));
        function addAllBranches() {
            console.log(colors.yellow('拉取所有的发布分支'));
            // 取出几个环境相应的分支
            cmd = '';
            envs.forEach((env) => {
                cmd += 'git checkout -b ' + env + ' origin/' + env + ' && ';
            });
            cmd += 'git checkout ' + type;
            console.log(cmd);
            exeCmd(cmd);
        }
        // 取得发布用的 git 地址
        if (argv.git) {
            let gitUrl = argv.git;
            console.log("发布代码地址：", gitUrl);
            // 创建发布目录
            fs.mkdirSync(publishDir, 0o755);

            try { // 尝试取这个分支的最新代码
                let cmd = 'git init && git remote add origin ' + gitUrl
                    + ' && git fetch origin ' + type
                    + ' && git checkout ' + type;
                console.log(cmd);
                exeCmd(cmd);
                // addAllBranches();
            } catch(ex) { // 线上目前没有这个分支
                // 创建新分支，并默认添加一个 README.md
                cmd = 'git checkout -b ' + type + ' master'
                    + ' && git push --set-upstream origin ' + type;
                console.log(colors.yellow('创建新分支...', type));
                exeCmd(cmd);
            }
            console.log(colors.yellow('初始化 publish 目录完成'));
        } else {
            const sleep = require('system-sleep');
            console.warn(colors.red(
                '如果您已有发布代码，请在10秒内按下 ctrl + c 中止当前任务，\n并添加参数设置它的 git 地址，\n命令格式：gulp init-pub --git <git-url>'));
            sleep(10 * 1000);
            // 没有发布代码，此时拉一份模板代码下来
            let cmd = 'git clone https://github.com/ngbook/pub-tpl.git '
                + publishDir;
            console.log(colors.yellow('开始拉取发布模板代码...', cmd));
            exeCmd(cmd, {inCurDir: true}); // 在当前目录执行

            addAllBranches();
            cmd = 'git remote rm origin';
            exeCmd(cmd);
            console.log(colors.red('请稍候手动添加您自己的发布代码 git 地址'));
        }
    }
    callback();
});

// 相关资源的路径
const PATHS = {
    dist_files: ['./dist/*.html', './src/favicon.ico']
};

/*
  上传 js 等七牛
*/
gulp.task('upload', function () {
    console.log(colors.yellow('CDN 访问地址：', newConf.cdnUrl));
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
    console.log(colors.yellow('开始替换 index.html 里相关引用的地址'));
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
    console.log(colors.yellow('开始替换 assets 资源文件地址'));
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
        const cmd = 'git checkout ' + type;
        exeCmd(cmd);
        try {
            console.log(colors.yellow('更新最新的' + type + '分支的发布代码'));
            exeCmd('git pull origin ' + type);
        } catch (ex) {
            console.log(colors.yellow('忽略以上错误，稍候您手动添加发布代码的 git 地址后，错误会自动消失...'));
        }
    } else {
        console.log(colors.red('参数错误'));
    }
    callback();
});

// 自动 git 提交本次编译的更新
gulp.task('auto-git-commit', function (callback) {
    console.log(colors.yellow('开始提交代码...'));
    if (envs.indexOf(type) >= 0) {
        const cmd = 'git add --all && git commit -m "auto-'
            + type + '-commit-' + version + '" '
            + '&& git push origin ' + type
        try {
            exeCmd(cmd);
        } catch (ex) {
            console.log(colors.yellow('忽略以上错误，稍候您手动添加发布代码的 git 地址后，错误会自动消失...'));
        }
        console.log(colors.green('提交成功'));
    } else {
        console.log(colors.red('参数错误'));
    }
    callback();
});

// 执行的步骤，也是默认的执行任务（默认test环境）
// 把upload放到最后，是因为七牛的上传是异步的，gulpSequence会误认为upload执行失败
gulp.task('default', gulpSequence('init-pub', 'auto-git-checkout', 'replace', 'auto-git-commit', 'upload'));

// 运行各个环境的发布操作
gulp.task('test', ['default']);
gulp.task('stg', ['default']);
gulp.task('prod', ['default']);
gulp.task('qa', ['default']);

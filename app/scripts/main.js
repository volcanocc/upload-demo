;(function (window) {

    var UPLOAD_TASK_GUID = 0;                //上传标识

    //上传状态
    var UPLOAD_STATE_READY = 0,              //任务已添加
        UPLOAD_STATE_READING = 1,            //文件读取中
        UPLOAD_STATE_PROCESSING = 2,         //任务上传中
        UPLOAD_STATE_COMPLETE = 3,           //任务上传完成
        UPLOAD_STATE_FAST = 4,               //任务秒传


        UPLOAD_STATE_SKIP = -1,              //任务已跳过
        UPLOAD_STATE_CANCEL = -2,            //任务已取消
        UPLOAD_STATE_ERROR = -3;             //任务已失败

    //状态提示
    var stateTips = {
        status_ready: '等待上传',
        status_reading: '读取中',
        status_processing: '上传中',
        status_complete: '已完成',
        status_fast: '秒传',
        status_skip: '已跳过',
        status_cancel: '已取消',
        status_error: '已失败'
    };

    var spark = new SparkMD5.ArrayBuffer();
    var blobSlice = File.prototype.slice || File.prototype.mozSlice || File.prototype.webkitSlice;

    /**
     * uploader
     * @param options
     * @param methods
     * @constructor
     */
    function Uploader(options, methods) {
        var self = this;
        self.uploadStatus = {
            READY: UPLOAD_STATE_READY,
            READING: UPLOAD_STATE_READING,
            PROCESSING: UPLOAD_STATE_PROCESSING,
            COMPLETE: UPLOAD_STATE_COMPLETE,
            FAST: UPLOAD_STATE_FAST,

            SKIP: UPLOAD_STATE_SKIP,
            CANCEL: UPLOAD_STATE_CANCEL,
            ERROR: UPLOAD_STATE_ERROR
        };

        self.uid = options.uid || '';
        self.token = options.token || '';

        self.url = options.url || '';                                    //上传url
        self.fastQueryUrl = options.fastQueryUrl || '';                  //秒传url
        self.createTaskUrl = options.createTaskUrl || '';                //创建上传任务url

        self.view = options.view || '';                                  //上传容器
        self.target = options.target;                                    //当前上传按钮
        self.auto = false;                                               //是否在添加任务后自动开始
        self.batch = false;                                              //自动序列上传
        self.html5 = true;                                               //是否以html5方式上传
        self.multiple = Utils.defaultValue(options.multiple, true);      //是否允许多选
        self.upName = options.upName || 'file';                          //上传参数名
        self.allowsMap = Utils.splitToMap(options.allows);               //允许上传的文件类型（扩展名）,逗号分隔
        self.chunkSize = options.chunkSize || 5 * 1024 * 1024;           //分片上传大小
        self.isSliceSize = options.isSliceSize || 30 * 1024 * 1024;      //超出该大小启用分片上传
        self.isQueryState = options.isQueryState || true;                //是否查询文件状态（秒传）
        self.isMd5 = options.isMd5 || true;                              //是否计算上传文件md5值
        self.isLog = options.isLog || false;                             //是否开启日志
        self.logBox = options.logBox;                                    //日志容器
        self.createUI = methods.createUI || function (task) {
            console.log(task)
        };
        self.updateUI = methods.updateUI || function (task) {
            console.log(task)
        };
        self.response = methods.response || function (res) {
            console.log(res)
        };

        //上传选项
        self.options = options;

        //init
        self.list = [];                                  // 上传任务列表
        self.map = {};                                   // 上传任务MAP

        self.index = 0;                                  // 上传任务索引
        self.started = false;                            // 任务已开始上传

        /**
         * 初始化
         */
        self.init = function () {
            var self = this;
            // 浏览器检测
            self.browserDetect();
        };

        self.initWidget = function () {
            self.resetInput();
        };

        /**
         * 初始化控件
         */
        self.resetInput = function () {
            var self = this;
            var inputFile = self.target;
            if (self.multiple) {
                inputFile.setAttribute('multiple', 'multiple')
            }
            //文件选择事件
            Utils.addEvent(inputFile, 'change', function (e) {
                self.addFiles(this);
            });
        };

        /**
         * 浏览器检测
         */
        self.browserDetect = function () {
            var XHR = window.XMLHttpRequest;
            if (XHR && new XHR().upload && window.FormData && window.SparkMD5 && window.File) {
                console.info('OK');
                self.initWidget();
            } else {
                return console.warn('请使用现代浏览器');
            }
        };

        self.init();
    }

    Uploader.prototype = {
        constructor: Uploader,
        //上传状态提示
        uploadStatusTips: function (state) {
            var tips = stateTips;
            switch (state) {
                case UPLOAD_STATE_READY:
                    return tips.status_ready;
                case UPLOAD_STATE_READING:
                    return tips.status_reading;
                case UPLOAD_STATE_PROCESSING:
                    return tips.status_processing;
                case UPLOAD_STATE_COMPLETE:
                    return tips.status_complete;
                case UPLOAD_STATE_FAST:
                    return tips.status_fast;

                case UPLOAD_STATE_SKIP:
                    return tips.status_skip;
                case UPLOAD_STATE_CANCEL:
                    return tips.status_cancel;
                case UPLOAD_STATE_ERROR:
                    return tips.status_error;
            }

            return state;
        },

        /**
         * 计算文件md5
         * @param task
         * @param callback
         * @param progress
         * @constructor
         */
        Md5: function (task, callback, progress) {
            var self = this;
            var size = task.file.size,
                chunks = Math.ceil(size / self.chunkSize),
                currentChunk = 0,
                fr = new FileReader(),
                startTime = Date.now();

            task.fr = fr;
            spark.reset();

            fr.onload = function (e) {
                spark.append(e.target.result);
                currentChunk++;
                progress && progress(currentChunk / chunks);

                if (currentChunk < chunks) {
                    loadNext();
                } else {
                    callback && callback(spark.end(), Date.now() - startTime);
                }
            };

            fr.onabort = function () {
                self.log(task.name + ': 文件分析中断!');
            };

            fr.onerror = function () {
                self.log(task.name + ': 文件分析错误!');
            };

            function loadNext() {
                var start = currentChunk * self.chunkSize,
                    end = ((start + self.chunkSize) >= size) ? size : start + self.chunkSize;
                fr.readAsArrayBuffer(blobSlice.call(task.file, start, end));
            }

            loadNext();
        },

        /**
         * 文件类型,大小检查
         * @param task
         * @returns {boolean}
         */
        fileTypeSizeCheck: function (task) {
            var self = this;
            task.ext = Utils.cutString(task.name, '.').toLowerCase();
            // 判断文件格式是否允许上传
            if (self.allowsMap) {
                var isSkip = !self.allowsMap[task.ext]
            }
            task.state = isSkip ? UPLOAD_STATE_SKIP : UPLOAD_STATE_READY;
            if (isSkip) {
                task.disabled = true
            }
            if (task.disabled) {
                var type = '';
                for (var key in self.allowsMap) {
                    type += key + ' ';
                }
                self.tipsInfo('允许上传的文件格式为：' + type);
                return
            }
            task.isSlice = task.size > self.isSliceSize;
            return true
        },

        /**
         * 获取指定任务
         * @param taskId
         * @returns {*}
         */
        getTask: function (taskId) {
            var self = this;
            if (taskId != undefined) {
                return self.map[taskId]
            }
        },

        /**
         * 清空任务列表
         * @param callback
         */
        clearTask: function (callback) {
            var self = this;
            for (var i = 0; i < self.list.length; i++) {
                if (self.list[i].state == UPLOAD_STATE_READING || self.list[i].state == UPLOAD_STATE_PROCESSING) {
                    self.tipsInfo('文件正在上传中，请等待取消或者完成后切换...');
                    callback && callback(false);
                    return
                }
            }
            self.list = [];
            self.map = {};
            callback && callback(true)
        },

        /**
         * 设置允许上传文件类型 '.jpg,.jpeg,.png,.gif'
         * @param val
         */
        setAllows: function (val) {
            var self = this;
            self.allowsMap = Utils.splitToMap(val);
        },


        //////////////////上传界面////////////////////////////////////////////////////////
        /**
         * 创建任务UI
         * @param task
         */
        createInterface: function (task) {
            var self = this;
            self.createUI(task);
            //---------------- 更新UI ----------------
            self.updateInterface(task);
        },

        /**
         * 更新任务UI
         * @param task
         */
        updateInterface: function (task) {
            var self = this;
            self.updateUI(task);
        },

        ///////////////////////////////上传控制///////////////////////////////////////////////////////////
        /**
         * 添加上传任务,自动判断文件多选
         * @param input_or_file
         */
        addFiles: function (input_or_file) {
            var self = this;
            if (input_or_file.tagName == 'INPUT') {
                var files = input_or_file.files;
                if (files) {
                    for (var i = 0, len = files.length; i < len; i++) {
                        self.addTask(input_or_file, files[i]);
                    }
                    self.target.value = '';
                } else {
                    self.addTask(input_or_file);
                }
            } else {
                self.addTask(undefined, input_or_file);
            }
        },

        /**
         * 添加上传任务
         * @param input
         * @param file
         * @returns {{id: number, name: *, size: *, sizeFm: *, input: *, file: *}}
         */
        addTask: function (input, file) {
            var self = this;
            if (!input && !file) {
                return
            }

            var name, size, sizeFm;
            if (file) {
                name = file.name || file.fileName;
                size = file.size || file.fileSize;
                sizeFm = Utils.formatSize(size);
            } else {
                name = Utils.cutString(input.value, '\\').slice(1) || input.value;
                size = -1;
            }

            var task = {
                id: ++UPLOAD_TASK_GUID,
                name: name,
                size: size,
                sizeFm: sizeFm,
                input: input,
                file: file
            };

            // 文件校验
            if (!self.fileTypeSizeCheck(task)) {
                return
            }
            task.index = self.list.length;
            self.list.push(task);
            self.map[task.id] = task;

            // 创建UI列表
            self.createInterface(task);
            if (self.auto) {
                self.start()
            }
            return task;
        },

        /**
         * 取消上传任务
         * @param task
         * @param onlyCancel
         * @returns {Uploader}
         */
        cancel: function (task, onlyCancel) {
            var self = this;
            if (!task) return;
            var state = task.state;
            //若任务已完成,直接返回
            if (state != UPLOAD_STATE_READY && state != UPLOAD_STATE_READING && state != UPLOAD_STATE_PROCESSING) {
                return self
            }
            if (state == UPLOAD_STATE_READING) {
                var fr = task.fr;
                if (fr) {
                    fr.abort();
                }
            }
            if (state == UPLOAD_STATE_PROCESSING) {
                var xhr = task.xhr;
                if (xhr) {
                    xhr.abort();
                }
            }
            return onlyCancel ? self : self.complete(task, UPLOAD_STATE_CANCEL);
        },

        /**
         * 上传完成
         * @param task
         * @param state
         * @param responseData
         * @returns {*}
         */
        complete: function (task, state, responseData) {
            var self = this;
            if (!task) {
                return self
            }

            if (state != undefined) {
                task.state = state
            }

            if (responseData) {
                task.responseData = responseData
            } else {
                task.responseData = ''
            }
            self.log(task.name + ': responseData ==> ' + JSON.stringify(task.responseData) || '');
            self.log(task.name + ': ' + self.uploadStatusTips(task.state) + '！');
            self.response(task.responseData);
            self.updateInterface(task);
            // 自动序列上传
            if (self.list.length > 0 && self.batch) {
                return self.startBatchTask();
            }
            if (task.index >= this.list.length - 1) {
                self.log('全部上传完成：' + '==============================================' + '<br />');
            }

            // if (self.started) {
            //     self.start()
            // }

            return self;
        },

        /**
         * 移除任务
         * @param task
         */
        remove: function (task) {
            var self = this;
            if (!task) {
                return
            }

            if (task.state == UPLOAD_STATE_READING || task.state == UPLOAD_STATE_PROCESSING) {
                this.cancel(task)
            }
            task.deleted = true;
            self.log(task.name + ': 已删除...');
        },

        /**
         * 开始上传
         * @param task
         * @returns {*}
         */
        start: function (task) {
            var self = this,
                list = self.list,
                count = list.length;
            if (!self.started) {
                self.started = true
            }
            self.batch = false;
            if (list.length > 0) {
                for (var i = 0; i < list.length; i++) {
                    if (list[i].state == UPLOAD_STATE_PROCESSING) {
                        return self;
                    }
                }
            }
            if (count <= 0) {
                return self
            }

            return self.upload(task);
        },

        /**
         * 批量开始上传
         * @returns {*}
         */
        startBatchTask: function () {
            var self = this,
                list = self.list;
            self.batch = true;
            if (list.length > 0) {
                for (var i = 0; i < list.length; i++) {
                    for (var i = 0; i < list.length; i++) {
                        if (list[i].state == UPLOAD_STATE_READY) {
                            return self.upload(list[i]);
                        }
                    }
                }
            }
        },

        /**
         * 上传
         * @param task
         * @returns {Uploader}
         */
        upload: function (task) {
            var self = this;
            if (!task || task.state != UPLOAD_STATE_READY || task.skip) {
                return self;
            }
            if (task.isSlice) {
                task.state = UPLOAD_STATE_READING
            }
            if (self.html5 && task.file) {
                self.uploadHtml5Ready(task)
            } else {
                self.complete(task, UPLOAD_STATE_SKIP)
            }
            return self;
        },

        /**
         * 重新上传任务
         * @param task
         * @returns {Uploader}
         */
        reUpload: function (task) {
            var self = this;
            if (self.html5 && task.file) {
                self.uploadHtml5Ready(task)
            } else {
                self.complete(task, UPLOAD_STATE_SKIP)
            }
            return self;
        },

        /**
         * 处理html5上传
         * @param task
         * @returns {Uploader}
         */
        uploadHtml5Ready: function (task) {
            var self = this;
            task.state = UPLOAD_STATE_READING;
            //计算文件md5
            var computeMD5 = function () {
                //计算上传文件md5值
                if (self.isMd5 && self.Md5) {
                    self.Md5(task, function (md5, time) {
                        task.MD5 = md5;
                        task.timeMD5 = time;
                        afterMD5();
                    }, function (pvg) {
                        task.pvg = pvg;
                        self.updateUI(task);
                    });
                } else {
                    afterMD5();
                }
            };

            var afterMD5 = function () {
                task.state = UPLOAD_STATE_PROCESSING;

                //自定义MD5事件
                if (task.MD5 && self.isQueryState && task.state != UPLOAD_STATE_COMPLETE) {
                    self.fastUploadQueryState(task)
                } else {
                    self.doUpload(task)
                }
            };

            computeMD5();
            return self;
        },

        /**
         * 根据MD5查询任务状态
         * @param task
         * @returns {Uploader}
         */
        fastUploadQueryState: function (task) {
            var self = this,
                url = self.fastQueryUrl + '?uid=' + self.uid + '&token=' + self.token + '&md5=' + task.MD5,
                xhr = new XMLHttpRequest();

            xhr.open('POST', url, true);
            xhr.onreadystatechange = function () {
                if (xhr.readyState != 4) {
                    return
                }
                if (xhr.status >= 200 && xhr.status < 400) {
                    var responseData = JSON.parse(xhr.response);
                    // 判断文件状态
                    switch (responseData.ret) {
                        case '0': // 文件已存在
                            task.queryOK = true;
                            task.state = UPLOAD_STATE_SKIP;
                            self.log('文件状态查询：已存在，秒传');
                            self.complete(task, UPLOAD_STATE_FAST, responseData);
                            break;
                        case '1': // 文件不存在，请求上传
                            self.log('文件状态查询：文件不存在，开始上传');
                            if (task.isSlice) {
                                task.chunkStart = responseData.currChunk || 0;
                                self.createUploadTask(task);
                            } else {
                                self.doUpload(task)
                            }
                            break;
                        default : // 其他请求错误
                            self.log('文件状态查询失败');
                            self.complete(task, UPLOAD_STATE_ERROR, responseData);
                            self.log(JSON.stringify(responseData));
                    }
                }
            };

            xhr.onerror = function () {
                self.tipsInfo('网络请求失败：请检查网络!');
                self.log('网络请求失败：请检查网络');
            };
            xhr.setRequestHeader('Content-type', 'application/json');
            var sendData = {
                uid: self.uid,
                fileinfo: task.MD5
            };

            xhr.send(JSON.stringify(sendData));
            return self;
        },

        /**
         * 创建上传任务
         * @param task
         * @returns {Uploader}
         */
        createUploadTask: function (task) {
            var self = this,
                url = self.createTaskUrl,
                xhr = new XMLHttpRequest();

            xhr.open('POST', url, true);
            xhr.onreadystatechange = function () {
                if (xhr.readyState != 4) {
                    return
                }
                if (xhr.status >= 200 && xhr.status < 400) {
                    var responseData = JSON.parse(xhr.response);
                    task.alreadySlice = responseData.currChunk || 0;
                    // upload
                    self.doUpload(task);
                }
            };

            xhr.onerror = function () {
                // callback && callback(self, xhr);
            };

            var sendData = {
                name: task.name,
                size: task.size,
                chunkSize: self.chunkSize,
                ext: task.ext,
                md5: task.MD5
            };

            xhr.send(JSON.stringify(sendData));

            return self;
        },


        /**
         * 上传处理
         * @param task
         */
        doUpload: function (task) {
            var self = this;

            if (task.state == UPLOAD_STATE_COMPLETE) {
                return
            }

            if (task.isSlice) {
                self.uploadSlice(task)
            } else {
                self.uploadHtml5(task)
            }
        },

        /**
         * 以html5的方式上传任务
         * @param task
         */
        uploadHtml5: function (task) {

            var self = this,
                xhr = new XMLHttpRequest(),
                url = self.url + '?uid=' + self.uid + '&token=' + self.token + '&md5=' + task.MD5;

            task.xhr = xhr;

            xhr.upload.addEventListener('progress', function (e) {
                self.progress(task, e.total, e.loaded);
            }, false);

            xhr.addEventListener('load', function (e) {
                self.complete(task, UPLOAD_STATE_COMPLETE, e.target.responseText);
            }, false);

            xhr.addEventListener('error', function () {
                self.complete(task, UPLOAD_STATE_ERROR);
            }, false);

            xhr.addEventListener('abort', function () {
                self.complete(task, UPLOAD_STATE_CANCEL);
            }, false);

            var fd = new FormData;
            fd.append(self.upName, task.blob || task.file);
            xhr.open('POST', url, true);
            xhr.send(fd);

            self.afterSend(task);
        },

        /**
         * 分片上传+断点续传
         * @param task
         */
        uploadSlice: function (task) {
            var self = this,
                file = task.blob || task.file,
                size = file.size,
                chunkSize = self.chunkSize,
                start = task.alreadySlice * self.chunkSize || 0,
                end;

            //分片总数
            task.sliceCount = Math.ceil(size / chunkSize);

            //分片上传
            var upload = function (blob, callback) {
                var xhr = new XMLHttpRequest(),
                    url = self.url + '?uid=' + self.uid + '&token=' + self.token + '&md5=' + task.MD5,
                    completed = end == size;

                task.xhr = xhr;

                xhr.open('POST', url);
                xhr.upload.addEventListener('progress', function (e) {
                    self.progress(task, size, start + e.loaded);
                }, false);

                xhr.addEventListener('load', function (e) {
                    var responseData = JSON.parse(e.target.responseText);
                    // 判断文件上传状态
                    switch (responseData.ret) {
                        case '0':
                            self.log('该分片上传成功');
                            //上传完毕
                            if (responseData.ret == 0 && completed) {
                                self.complete(task, self.uploadStatus.COMPLETE, e.target.responseText)
                            } else {
                                callback && callback();
                            }
                            break;
                        default : // 其他请求错误
                            self.complete(task, self.uploadStatus.ERROR, e.target.responseText);
                            self.log(task.sliceIndex + '分片上传失败')
                    }
                }, false);

                xhr.addEventListener('error', function () {
                    self.complete(task, self.uploadStatus.ERROR);
                }, false);

                var fd = new FormData;
                fd.append(self.upName, blob);

                xhr.send(fd);

            };

            //递归上传直至上传完毕
            var startUpload = function () {
                if (start >= size) {
                    return;
                }
                end = start + chunkSize;
                if (end > size) {
                    end = size
                }

                task.sliceStart = start;
                task.sliceEnd = end;
                task.sliceIndex = Math.ceil(end / chunkSize);

                //分片上传事件，分片上传之前触发，返回false将跳过该分片
                self.log(task.name + ': 上传分片 ' + task.sliceIndex + ' / ' + task.sliceCount);

                var chunk = blobSlice.call(file, start, end);
                upload(chunk, nextUpload);
            };

            //上传下一个分片
            var nextUpload = function () {
                start = end;
                startUpload();
            };

            startUpload();
            self.afterSend(task);
        },

        /**
         * 已开始发送数据
         * @param task
         */
        afterSend: function (task) {
            var self = this;
            task.lastTime = task.startTime = Date.now();
            self.progress(task);
        },

        /**
         * 更新进度显示
         * @param task
         * @param total
         * @param loaded
         */
        progress: function (task, total, loaded) {
            var self = this;
            if (!total) {
                total = task.size
            }
            if (!loaded || loaded < 0) {
                loaded = 0
            }

            var state = task.state || UPLOAD_STATE_READY;

            if (loaded > total) {
                loaded = total
            }
            if (loaded > 0 && state == UPLOAD_STATE_READY) {
                task.state = state = UPLOAD_STATE_PROCESSING
            }


            var completed = state == UPLOAD_STATE_COMPLETE || state == UPLOAD_STATE_FAST;

            if (completed) {
                total = loaded = task.size
            }

            //计算上传速度
            self.setTaskSpeed(task, total, loaded);

            task.total = total;
            task.loaded = loaded;
            task.loadedFm = Utils.formatSize(loaded);

            self.updateInterface(task);
        },

        /**
         * 计算上传速度
         * @param task
         * @param total
         * @param loaded
         */
        setTaskSpeed: function (task, total, loaded) {
            if (!total || total <= 0) {
                return
            }
            var nowTime = Date.now(), tick;

            //上传完毕,计算平均速度(Byte/s)
            if (loaded >= total) {
                if (task.queryOK) {
                    task.startTime = nowTime;
                }
                tick = nowTime - task.startTime;
                if (tick) {
                    task.avgSpeed = Math.min(Math.round(total * 1000 / tick), total);
                    task.avgSpeedFm = Utils.formatSize(task.avgSpeed);
                } else if (!task.speed) {
                    task.avgSpeed = task.speed = total;
                    task.avgSpeedFm = Utils.formatSize(task.avgSpeed);
                }

                task.time = tick || 0;
                task.endTime = nowTime;
                return;
            }

            //即时速度
            tick = nowTime - task.lastTime;
            if (tick < 200) {
                return
            }

            if (!task.loaded) {
                task.loaded = 0
            }
            task.speed = Math.min(Math.round((loaded - task.loaded) * 1000 / tick), task.total);
            task.speedFm = Utils.formatSize(task.speed);
            task.lastTime = nowTime;
        },

        tipsInfo: function (msg) {
            var uploadTipsBox = document.getElementById('upload-info');
            uploadTipsBox.innerHTML = (msg != undefined ? msg : '');
            uploadTipsBox.style.display = 'block';
            Utils.addEvent(uploadTipsBox, 'click', function () {
                uploadTipsBox.style.display = 'none';
            })
        },

        /**
         * 日志
         * @param msg
         */
        log: function (msg) {
            var self = this;
            if (self.isLog && self.logBox != undefined) {
                var logBox = self.logBox;
                logBox.innerHTML += (msg != undefined ? msg : '') + '<br />';
            } else if(self.isLog && self.logBox == undefined){
                console.info(msg != undefined ? msg : '');
            }
        }
    };

    /////////////////////// 工具方法 ///////////////////////////////////////////////////////////////////
    var Utils = {};

    Utils.defaultValue = function (value, defValue) {
        return value !== undefined ? value : defValue;
    };

    //检测是否为正整数
    Utils.isUInt = function (n) {
        return typeof n == 'number' && n > 0 && n === Math.floor(n);
    };

    //截取字符串
    Utils.cutString = function (str, find) {
        var index = str.lastIndexOf(find);
        return index != -1 ? str.slice(index) : '';
    };

    //逗号分隔转map
    Utils.splitToMap = function (str) {
        if (!str) return;
        var list = str.split(','), map = {};
        for (var i = 0; i < list.length; i++) {
            map[list[i]] = true;
        }
        return map;
    };

    //添加class
    Utils.addClass = function (elements, cName) {
        if (!Utils.hasClass(elements, cName)) {
            elements.className += ' ' + cName;
        }
    };

    //hasClass
    Utils.hasClass = function (elements, cName) {
        return !!elements.className.match(new RegExp('(\\s|^)' + cName + '(\\s|$)')); // ( \\s|^ ) 判断前面是否有空格 （\\s | $ ）判断后面是否有空格 两个感叹号为转换为布尔值 以方便做判断
    };

    //移除class
    Utils.removeClass = function (elements, cName) {
        if (hasClass(elements, cName)) {
            elements.className = elements.className.replace(new RegExp('(\\s|^)' + cName + '(\\s|$)'), ' '); // replace方法是替换
        }
    };

    //-------------------------- event ---------------------------

    if (document.addEventListener) {  //w3c
        Utils.addEvent = function (ele, type, fn) {
            ele.addEventListener(type, fn, false);
        };
        Utils.removeEvent = function (ele, type, fn) {
            ele.removeEventListener(type, fn, false);
        };
    } else if (document.attachEvent) {  //IE
        Utils.addEvent = function (ele, type, fn) {
            ele.attachEvent('on' + type, fn);
        };
        Utils.removeEvent = function (ele, type, fn) {
            ele.detachEvent('on' + type, fn);
        };
    }

    //单位转换
    Utils.parseLevel = function (size, steps, limit) {
        size = +size;
        steps = steps || 1024;
        var level = 0,
            isNum = typeof steps == 'number',
            stepNow = 1,
            count = Utils.isUInt(limit) ? limit : (isNum ? 100 : steps.length);
        while (size >= stepNow && level < count) {
            stepNow *= (isNum ? steps : steps[level]);
            level++;
        }
        if (level && size < stepNow) {
            stepNow /= (isNum ? steps : steps.last());
            level--;
        }
        return {value: level ? size / stepNow : size, level: level};
    };

    var UNITS_FILE_SIZE = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];

    Utils.formatSize = function (size, ops) {
        ops = ops === true ? {all: true} : ops || {};
        if (isNaN(size) || size == undefined || size < 0) {
            var error = ops.error || '--';
            return ops.all ? {text: error} : error;
        }
        var pl = Utils.parseLevel(size, ops.steps, ops.limit),
            value = pl.value,
            text = value.toFixed(Utils.defaultValue(ops.digit, 2));
        if (ops.trim !== false && text.lastIndexOf('.') != -1) text = text.replace(/\.?0+$/, '');
        pl.text = text + (ops.join || '') + (ops.units || UNITS_FILE_SIZE)[pl.level + (ops.start || 0)];
        return ops.all ? pl : pl.text;
    };

    window.Uploader = Uploader;

})(window);

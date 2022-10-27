/* Проброс авторизации на датапровайдер (cookie) */
async function setCookie(udfUrl, token, traderId) {
    if (!token || !token.length || !traderId || !traderId.length) {
        return false
    }

    var res = await fetch(udfUrl + '/set_cookie', {
        credentials: 'include',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        method: 'POST',
        body: JSON.stringify({
            token: token,
            traderId: traderId,
        }),
    })

    res = await res.json()

    return res && typeof res.success === 'boolean' && res.success
}

class Chart {
    __constructor (config, mod, data) {
        var _this = this;
        
        // Данные
        this.config = config;
        this.mod = mod;
        this.data = data;

        this.data.chart = {
            cid: 0,     // по умолчанию
            selected_symbol: null,
            charts: [],
            // для расчетов в абсолютных значениях 
            lots: {},  
            prices: {},
            sides: {},
        };
    }

    select (symbol=null, reload=true, find_cid=false) {
        if (symbol) {
            if (this.selected_symbol != symbol) {
                this.selected_symbol = symbol;
                if (reload) {
                    try {
                        this.mod.pos_edit.pairChangedReload ();
                    } catch (e) {}
                }
                if (find_cid) {
                    for (let i = 0; i < this.data.chart.charts.length; i ++) {
                        let chart = this.data.chart.charts[i];
                        
                        if (chart.symbol.symbol == this.selected_symbol) {
                            this.data.chart.cid = chart.id;
                        }
                    }
                }
            } else {
                return false;
            }
        }
        if (!this.selected_symbol) return false;

        for (var i = 0; i < this.data.chart.charts.length; i ++) {
            let chart = this.data.chart.charts[i];

            if (chart.w) {
                chart.w.select (chart.symbol.symbol == this.selected_symbol);
            }
        }

        return true;
    }

    init (resolve, reject) {
        var _this = this;

        // Проброс авторизации
        const trader = this.mod.terminal.config.default.trader
        setCookie(this.config.udf.url, trader.token, trader.id).then ((success) => {
            _this.__init (resolve, reject);
        });
    }
    
    __init (resolve, reject) {
        var _this = this;

        // Мультичарт
        this.data.chart.charts = [];
        var line = [];

        for (var i = 0; i < _this.data.core.symbols.length; i ++) {
            let chart = {
                id: i,
                symbol: _this.data.core.symbols[i],
                lines: {},
                queue_lines: [],
                ready: false,
                time: null,
                price: null,
                w: null,
            };

            line.push (new Promise ((resolve, reject) => {

                // Виджет для вывода
                chart.w = new Widget ('chart_' + chart.id, chart.symbol.symbol);
                chart.w.init ({
                    on_connected: () => {
                        // try {

                            chart.chart = new TradingView.widget ({
                                // debug: true, // uncomment _this line to see Library errors and warnings in the console
                                fullscreen: false,
                                symbol: chart.symbol.symbol, 
                                height: $('#' + chart.w.uid+" .content_framing").height (),
                                width: $('#' + chart.w.uid+" .content_framing").outerWidth (),
                                interval: chart.symbol.interval,
                                container_id: chart.w.content.id,
                                //  BEWARE: no trailing slash is expected in feed URL
                                datafeed: new Datafeeds.UDFCompatibleDatafeed (_this.config.udf.url, _this.config.udf.timeout),
                                library_path: 'charting_library/',
                                locale: 'en',

                                disabled_features: ['use_localstorage_for_settings'],
                                timezone: _this.data.core.timezone,
                                enabled_features: ['study_templates'],
                                charts_storage_url: _this.config.charts_storage_url,
                                charts_storage_api_version: '1.1',
                                client_id: _this.data.core.trader.id,
                                user_id: _this.data.core.trader.id,
                            });

                            chart.chart.onChartReady (function () {

                                chart.ready = true;

                                // Привязка событий
                                // Смена символа
                                chart.chart.chart ().onSymbolChanged ().subscribe (null, function (symbol, obj) {
                                    chart.symbol = symbol;
                                    _this.select (symbol.symbol);
                                    chart.w.setTitle (symbol.symbol);
                                    // ... (сохранение)
                                });   

                                chart.chart.chart ().onIntervalChanged ().subscribe (null, function (interval, obj) {   
                                    // ... (сохранение)
                                });

                                chart.chart.activeChart ().crossHairMoved ((chart_point) => {
                                    // Обновление значения
                                    chart.time = chart_point.time;
                                    chart.price = chart_point.price;

                                    // Простановка значения
                                    if (_this.data.pos_edit && _this.data.pos_edit.active_price_input && _this.data.pos_edit.current_pair == chart.symbol.symbol) {
                                        try {
                                            let metadata = _this.data.init.metadata;
                                            $(_this.data.pos_edit.active_price_input).val (chart_point.price.toFixed (metadata[chart.symbol.symbol].precision));
                                        } catch (e) {}
                                    }
                                });

                                $('#' + chart.w.content.id + ' iframe').contents ().find ('canvas').bind ('click', function (e) {
                                    // Выбор
                                    _this.data.chart.cid = chart.id;
                                    _this.select (chart.symbol.symbol);

                                    // Отмена выделения
                                    if (_this.data.pos_edit.active_price_input && _this.data.pos_edit.current_pair == chart.symbol.symbol) {
                                        $(_this.data.pos_edit.active_price_input).trigger ('change');
                                        _this.mod.pos_edit.toggleSelect (null);
                                    }
                                });

                                // Дорисовка линий (чтобы не грузить форму последовательно после графиков при обновлении страницы)
                                for (let i = 0; i < chart.queue_lines.length; i ++) {
                                    let v = chart.queue_lines[i];
                                    if (v.action == 'add') {
                                        _this.manageLine (v.pair, v.price, v.type, v.id, v.input_to_modify);
                                    }
                                    if (v.action == 'redraw') {
                                        _this.redrawLines (v.pair);
                                    }
                                }

                                // @TODO требуется обновлять весь сетап - то есть список, в нем пары и интервалы
                                resolve ();
                            });

                        // } catch (e) {
                        //     console.log ('TV error:', e);
                        //     reject ('Chart loading error');
                        // }
                    },
                    on_resize: () => {
                        if (chart.ready) {
                            _this.fit (chart.w.uid);
                            return true;
                        } else {
                            return false;
                        }
                    },
                    on_resized: () => {
                        if (chart.ready) {
                            _this.fit (chart.w.uid);
                        }
                    },
                    on_clicked: () => {
                        _this.data.chart.cid = chart.id;
                        _this.select (chart.symbol.symbol);
                    },
                })

                $(chart.w.content).html ('Loading chart...');

                // Сохранение
                this.data.chart.charts.push (chart);
            }));
        }

        // Параллельная инициализация
        Promise.all (line).then (() => {
            
            // Selecting the default
            _this.select (_this.data.chart.charts[_this.data.chart.cid].symbol.symbol);

            // Complete
            resolve ();

        }, (e) => {
            console.log (e);
        });
    }

    fit (w_uid) {
         $('#' + w_uid + ' iframe').height ($('#' + w_uid+" .content_framing").height ());
         $('#' + w_uid + ' iframe').width ($('#' + w_uid+" .content_framing").outerWidth ());
    }

    cidsWithPair (pair) {
        let cids = [];
        for (let i = 0; i < this.data.chart.charts.length; i ++) {
            var chart = this.data.chart.charts[i];
            if (chart.symbol.symbol == pair) {
                cids.push (i)
            }
        }
        return cids;
    }

    manageLine (pair, price, type, id, input_to_modify) {
        console.log ('manageLine', pair, price, type, id, input_to_modify);
        
        var _this = this;
        var metadata = this.data.init.metadata;
        var cids = this.cidsWithPair (pair);

        var colors = {
            PRICE: '#01017a',
            TP: '#1e824c',
            SL: '#96281b',
            ALERT: '#663399',
        };

        let color = '#222';
        for (let k in colors) {
            if (type.indexOf (k) != -1) {
                color = colors[k];
            }
        }

        for (var i = 0; i < cids.length; i ++) {
            var chart = this.data.chart.charts[cids[i]];

            // Проверка на существование
            if (typeof chart.lines[id] == 'undefined') {

                // Добавление (с учетом параллельной загрузки)
                if (!chart.ready) {
                    chart.queue_lines.push ({
                        action: 'add',
                        pair: pair,
                        price: price,
                        type: type,
                        id: id,
                        input_to_modify: input_to_modify,
                    });
                } else {
                    // try {
                        const getLineLotText = (price, diff) => {
                            if (typeof _this.data.chart.lots[pair] != 'undefined' && (type == 'TP' || type == 'SL')) {
                                let text = (diff * _this.data.chart.lots[pair]).toFixed (2);
                                if (diff >= 0) {
                                    text = '+' + text;
                                }
                                return ', $' + text;
                            }
                            return '';
                        };

                        const getLineText = (line_price) => {
                            var price = metadata[pair].ticker.bid;
                            
                            /*
                            if (typeof _this.data.chart.prices[pair] != 'undefined' && (type == 'TP' || type == 'SL')) {
                                price = _this.data.chart.prices[pair];
                            }
                            */ // @TODO каждый с каждым

                            var diff = line_price - price;
                            
                            var side = 'BUY';
                            if (typeof _this.data.chart.sides[pair] != 'undefined' && (type == 'TP' || type == 'SL')) {
                                side = _this.data.chart.sides[pair];
                            }
                            if (side == 'SELL') {
                                diff *= -1;
                            }

                            var p_diff = (diff / price) * 100;

                            if (diff >= 0) {
                                return '+' + diff.toFixed (metadata[pair].precision) + ' (+' + p_diff.toFixed (2) + '%' + getLineLotText (price, diff) + ')';
                            } else {
                                return diff.toFixed (metadata[pair].precision) + ' (' + p_diff.toFixed (2) + '%' + getLineLotText (price, diff) + ')';
                            }
                        };

                        var line = chart.chart.chart ().createOrderLine ()
                            .onMove (function (a, b) {
                                if (chart.ready) {
                                    this.setText (getLineText (this.getPrice ()));

                                    $(this.input_to_modify).val (this.getPrice ().toFixed (metadata[pair].precision));
                                    $(this.input_to_modify).trigger ('change');
                                }
                            })
                            .onModify ("onModify called", function (text) {
                                // nope
                            })
                            .onCancel ("onCancel called", function (text) {
                                if (chart.ready) {
                                    this.remove ();
                                    delete chart.lines[id];
                                    
                                    $(this.input_to_modify).val ('');
                                    $(this.input_to_modify).trigger ('change');
                                }
                            })
                            .setText (getLineText (price))
                            .setPrice (price)
                            .setLineColor (color)
                            .setBodyBorderColor (color)
                            .setBodyTextColor (color)
                            .setQuantityBorderColor (color)
                            .setQuantityBackgroundColor (color)
                            .setCancelButtonBorderColor (color)
                            .setCancelButtonIconColor (color)
                            .setQuantity (type);

                        line.redraw = (__this) => {
                            if (chart.ready) {
                                __this.setText (getLineText (__this.getPrice ()));
                            }
                        };

                        line.input_to_modify = input_to_modify;
                        chart.lines[id] = line;
                    // } catch (e) {
                    //     console.log ('manageLine (create) error:', e, 'params:', pair, price, type, id, input_to_modify);
                    // }

                    chart.lines[id] = line;
                }
            } else {
                chart.lines[id].setPrice (price);
                chart.lines[id].input_to_modify = input_to_modify;
            }
        }
    }

    removeLine (pair, id) {
        var _this = this;
        var cids = this.cidsWithPair (pair);

        for (var i = 0; i < cids.length; i ++) {
            var chart = this.data.chart.charts[i];

            if (typeof chart.lines[id] != 'undefined') {
                chart.lines[id].remove ();
                delete chart.lines[id];
            }
        }
    }

    removeLines (pair=null) {
        var _this = this;
      
        for (var i = 0; i < this.data.chart.charts.length; i ++) {
            var chart = this.data.chart.charts[i];

            if (!pair || chart.symbol.symbol == pair) {
                for (let k in chart.lines) {
                    chart.lines[k].remove ();
                    delete chart.lines[k];
                }
            }
        }
    }

    redrawLines (pair=null) {
        var _this = this;
        for (var i = 0; i < this.data.chart.charts.length; i ++) {
            var chart = this.data.chart.charts[i];

            if (!chart.ready) {
                chart.queue_lines.push ({
                    action: 'redraw',
                    pair: pair,
                });
            } else {
                if (!pair || chart.symbol.symbol == pair) {
                    for (let k in chart.lines) {
                        var line = chart.lines[k];

                        // try {
                            line.redraw (line);
                        // } catch (e) {
                        //     console.log ('line.redraw exception:', e);
                        // };
                    }
                }
            }
        }
    }

    updateLot (pair, index, lot) {
        if (typeof this.data.chart.lots[pair] == 'undefined') {
            this.data.chart.lots[pair] = {};
        }

        this.data.chart.lots[pair][index] = lot;
        this.redrawLines (pair);
    }

    deleteLot (pair, index) {
        // try {
            delete this.data.chart.lots[pair][index];
        // } catch (e) {}
        
        this.redrawLines (pair);
    }

    updatePrice (pair, index, price) {
        if (typeof this.data.chart.prices[pair] == 'undefined') {
            this.data.chart.prices[pair] = {};
        }

        this.data.chart.prices[pair][index] = price;
        console.log ('this.data.chart.prices', this.data.chart.prices); // @TMP
        // this.redrawLines (pair);
    }

    deletePrice (pair=null, index=null) {
        if (pair) {
            try {
                delete this.data.chart.prices[pair][index];
            } catch (e) {}
        } else {
            this.data.chart.prices = {};
        }

        this.redrawLines (pair);
    }

    updateSide (pair, side) {
        this.data.chart.sides[pair] = side;
        this.redrawLines (pair);
    }
}

// end of file

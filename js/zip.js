/* ==========================================================================
   zip.js — сборка ZIP-архива в браузере без зависимостей.
   Файлы кладутся без сжатия (method 0 «store») — PNG и так уже сжат.

   Использование:
     const zip = new ZipWriter();
     zip.add('frame_001.png', uint8Array);
     const blob = zip.finish();   // Blob('application/zip')
   ========================================================================== */

(function (global) {
  'use strict';

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    var c = 0xffffffff;
    for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosTime(d) {
    return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  }
  function dosDate(d) {
    return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  }

  function ZipWriter() {
    this.parts = [];    // куски данных для Blob
    this.entries = [];  // метаданные для центрального каталога
    this.offset = 0;
    this.date = new Date();
  }

  ZipWriter.prototype.add = function (name, data) {
    var nameBytes = new TextEncoder().encode(name);
    var crc = crc32(data);
    var time = dosTime(this.date), date = dosDate(this.date);

    var head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); // сигнатура
    head.setUint16(4, 20, true);         // версия
    head.setUint16(6, 0x0800, true);     // флаги: имена в UTF-8
    head.setUint16(8, 0, true);          // без сжатия
    head.setUint16(10, time, true);
    head.setUint16(12, date, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, data.length, true);
    head.setUint32(22, data.length, true);
    head.setUint16(26, nameBytes.length, true);
    head.setUint16(28, 0, true);

    this.parts.push(new Uint8Array(head.buffer), nameBytes, data);
    this.entries.push({
      nameBytes: nameBytes, crc: crc, size: data.length,
      offset: this.offset, time: time, date: date
    });
    this.offset += 30 + nameBytes.length + data.length;
  };

  ZipWriter.prototype.finish = function () {
    var cdParts = [], cdSize = 0;

    for (var i = 0; i < this.entries.length; i++) {
      var e = this.entries[i];
      var dv = new DataView(new ArrayBuffer(46));
      dv.setUint32(0, 0x02014b50, true);
      dv.setUint16(4, 20, true);   // версия создателя
      dv.setUint16(6, 20, true);   // минимальная версия
      dv.setUint16(8, 0x0800, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, e.time, true);
      dv.setUint16(14, e.date, true);
      dv.setUint32(16, e.crc, true);
      dv.setUint32(20, e.size, true);
      dv.setUint32(24, e.size, true);
      dv.setUint16(28, e.nameBytes.length, true);
      dv.setUint16(30, 0, true);   // extra
      dv.setUint16(32, 0, true);   // comment
      dv.setUint16(34, 0, true);   // номер диска
      dv.setUint16(36, 0, true);   // внутренние атрибуты
      dv.setUint32(38, 0, true);   // внешние атрибуты
      dv.setUint32(42, e.offset, true);
      cdParts.push(new Uint8Array(dv.buffer), e.nameBytes);
      cdSize += 46 + e.nameBytes.length;
    }

    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, this.entries.length, true);
    end.setUint16(10, this.entries.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, this.offset, true);
    end.setUint16(20, 0, true);

    return new Blob(this.parts.concat(cdParts, [new Uint8Array(end.buffer)]),
      { type: 'application/zip' });
  };

  global.ZipWriter = ZipWriter;
})(typeof window !== 'undefined' ? window : this);

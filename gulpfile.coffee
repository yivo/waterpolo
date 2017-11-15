gulp     = require('gulp')
gplumber = require('gulp-plumber')
gcoffee  = require('gulp-coffee')
greplace = require('gulp-replace')

gulp.task 'default', ['build', 'watch'], ->

gulp.task 'build', ->
  gulp.src(['./src/**/*.coffee'])
    .pipe(gplumber())
    .pipe(greplace('.coffee', ''))
    .pipe(gcoffee(bare: true))
    .pipe(gulp.dest('./dist'))

gulp.task 'watch', ->
  gulp.watch(['./src/**/*'], ['build'])

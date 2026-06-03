/**
 * jquery.tcfloatbox.js
 *
 * @param {Object} $ The jQuery object
 * @version: v2.0
 * @author: ThemeComplete
 *
 * Created by ThemeComplete
 *
 * Copyright (c) 2025 themeComplete http://themecomplete.com
 */
( function( $ ) {
	'use strict';

	var FloatBox = function( dom, options ) {
		this.element = $( dom );

		this.settings = $.extend( {}, $.fn.tcFloatBox.defaults, options );
		this.settings.type = '<' + this.settings.type + '>';

		if ( this.element.length === 1 ) {
			this.init();
			return this;
		}

		return false;
	};

	FloatBox.prototype = {
		constructor: FloatBox,

		destroy: function() {
			var settings = this.settings;

			if ( this.instance !== undefined ) {
				$.fn.tcFloatBox.instances.splice( this.instance, 1 );

				delete this.instance;

				if ( settings.hideelements ) {
					$( 'embed, object, select' ).css( {
						visibility: 'visible'
					} );
				}

				if ( settings._ovl ) {
					settings._ovl.off();
				}

				$( settings.floatboxIDMain ).remove();

				this.element.removeData( 'tcfloatbox' );

				$( window ).off( 'scroll.tcfloatbox' + this.instance );
				$( window ).off( 'resize.tcfloatbox' + this.instance );
			}

			return this;
		},

		hide: function() {
			var settings = this.settings;

			if ( settings.hideelements ) {
				$( 'embed, object, select' ).css( {
					visibility: 'visible'
				} );
			}
			if ( settings.showoverlay === true ) {
				if ( settings._ovl ) {
					settings._ovl.removeClass( 'fl-overlay' );
				}
			}

			$( settings.floatboxID )
				.addClass( 'tc-closing' )
				.removeClass( settings.animateIn )
				.addClass( settings.animateOut );
			$( settings.floatboxID ).animate(
				{
					opacity: 0
				},
				settings.closefadeouttime,
				function() {
					$( settings.floatboxIDMain ).hide();
					$( settings.floatboxID )
						.removeClass( 'tc-closing' )
						.addClass( 'tc-closed' );
				}
			);

			$( window ).off( 'scroll.tcfloatbox' + this.instance );
			$( window ).off( 'resize.tcfloatbox' + this.instance );
		},

		show: function() {
			var settings = this.settings;

			if ( this.element.length === 1 ) {
				if ( this.instance === undefined ) {
					this.init();
				}

				if ( settings.hideelements ) {
					$( 'embed, object, select' ).css( {
						visibility: 'hidden'
					} );
				}

				if ( settings.showoverlay === true ) {
					if ( ! settings._ovl ) {
						settings._ovl = settings.main;
						settings._ovl.css(
							{
								zIndex: parseInt( settings.zIndex, 10 ) - 1
							}
						);
						if ( ! settings.ismodal ) {
							if ( settings.cancelEvent || settings.unique ) {
								settings._ovl.on(
									'click',
									function( e ) {
										if ( e.target === $( settings.floatboxID )[ 0 ] || $( e.target ).closest( settings.floatboxID ).length ) {
											return;
										}
										this.applyCancelEvent.call( this, this );
									}.bind( this )
								);
							} else {
								settings._ovl.on(
									'click',
									function( e ) {
										if ( e.target === $( settings.floatboxID )[ 0 ] || $( e.target ).closest( settings.floatboxID ).length ) {
											return;
										}
										settings.cancelfunc.call( this, this );
									}.bind( this )
								);
							}
						}
					}
					settings._ovl.addClass( 'fl-overlay' );
				}

				if ( settings.showfunc ) {
					settings.showfunc.call();
				}

				$( settings.floatboxID )
					.removeClass( 'tc-closing tc-closed' )
					.addClass(
						settings.animationBaseClass + ' ' + settings.animateIn
					);

				$( settings.floatboxID ).addClass( 'flasho-center' );
			}
		},

		applyCancelEvent: function() {
			var settings = this.settings;

			if ( settings.cancelEvent === true ) {
				this.destroy();
			} else if ( typeof settings.cancelEvent === 'function' ) {
				settings.cancelEvent.call( this, this );
			}
		},

		applyCancelEventFromKey: function( e ) {
			if ( e.which === 27 ) {
				this.applyCancelEvent();
			}
		},

		applyUpdateEvent: function() {
			var settings = this.settings;

			if ( typeof settings.updateEvent === 'function' ) {
				settings.updateEvent.call( this, this );
			}
		},

		applyUpdateEventFromKey: function( e ) {
			if ( e.which === 13 ) {
				this.applyUpdateEvent();
			}
		},

		init: function() {
			var settings = this.settings;
			var main;

			if ( this.element.length === 1 ) {
				// Instance initialization
				if ( $.fn.tcFloatBox.instances.length > 0 ) {
					settings.zIndex =
						parseInt(
							$.fn.tcFloatBox.instances[
								$.fn.tcFloatBox.instances.length - 1
							].zIndex,
							10
						) + 100;
				}
				this.instance = $.fn.tcFloatBox.instances.length;
				$.fn.tcFloatBox.instances.push( settings );

				settings.id = settings.id + this.instance;
				settings.floatboxID = '#' + $.epoAPI.dom.id( settings.id );

				if ( settings.idMain === settings.id ) {
					settings.idMain = 'main-' + settings.idMain;
				}

				settings.idMain = settings.idMain + this.instance;
				settings.floatboxIDMain = '#' + $.epoAPI.dom.id( settings.idMain );

				this.hide();

				main = $( '<div>' )
					.attr( 'id', settings.idMain )
					.addClass( settings.classnameMain );

				$( settings.type )
					.attr( 'id', settings.id )
					.addClass( settings.classname )
					.html( settings.data )
					.appendTo( main );

				main.appendTo( this.element );

				settings.main = main;

				if ( settings.leger ) {
					$( settings.floatboxIDMain ).css( {
						width: settings.width,
						height: settings.height
					} );
				} else {
					$( settings.floatboxID ).css( {
						width: settings.width,
						height: settings.height
					} );
				}

				if ( settings.minWidth ) {
					$( settings.floatboxID ).css( {
						'min-width': settings.minWidth
					} );
				}

				if ( settings.minHeight ) {
					$( settings.floatboxID ).css( {
						'min-height': settings.minHeight
					} );
				}

				if ( settings.maxWidth ) {
					$( settings.floatboxID ).css( {
						'max-width': settings.maxWidth
					} );
				}

				if ( settings.maxHeight ) {
					$( settings.floatboxID ).css( {
						'max-height': settings.maxHeight
					} );
				}

				$( settings.floatboxIDMain ).css( {
					'z-index': settings.zIndex
				} );

				this.cancelfunc = settings.cancelfunc;

				if ( settings.cancelEvent && settings.cancelClass ) {
					$( settings.floatboxID )
						.find( settings.cancelClass )
						.on( 'click', this.applyCancelEvent.bind( this ) );
					if ( settings.isconfirm ) {
						$( document )
							.off( 'keyup.escape-' + settings.floatboxID )
							.on(
								'keyup.escape-' + settings.floatboxID,
								this.applyCancelEventFromKey.bind( this )
							);
					}
				}

				if ( settings.updateEvent && settings.updateClass ) {
					$( settings.floatboxID )
						.find( settings.updateClass )
						.on( 'click', this.applyUpdateEvent.bind( this ) );
					if ( settings.isconfirm ) {
						$( document )
							.off( 'keyup.enter-' + settings.floatboxID )
							.on(
								'keyup.enter-' + settings.floatboxID,
								this.applyUpdateEventFromKey.bind( this )
							);
					}
				}

				this.show();
			}
		}
	};

	$.fn.tcFloatBox = function( option ) {
		var methodReturn;
		var targets = $( this );
		var data = targets.data( 'tcfloatbox' );
		var options;
		var ret;

		if ( typeof option === 'object' ) {
			options = option;
		} else {
			options = {};
		}

		if ( ! data ) {
			data = new FloatBox( this, options );
			targets.data( 'tcfloatbox', data );
		}

		if ( typeof option === 'string' ) {
			methodReturn = data[ option ].apply( data, [] );
		}

		if ( methodReturn === undefined ) {
			ret = targets;
		} else {
			ret = methodReturn;
		}

		return ret;
	};

	$.fn.tcFloatBox.defaults = {
		idMain: 'floatbox',
		classnameMain: 'floatbox',
		leger: false,
		id: 'flasho',
		classname: 'flasho',
		type: 'div',
		data: '',
		width: 'auto',
		height: 'auto',
		minWidth: 0,
		minHeight: 0,
		maxWidth: 0,
		maxHeight: 0,
		closefadeouttime: 1000,
		animationBaseClass: 'tm-animated',
		animateIn: 'fadein',
		animateOut: 'fadeout',
		fps: 4,
		hideelements: false,
		showoverlay: true,
		zIndex: 100100,
		ismodal: false,
		cancelfunc: FloatBox.prototype.hide,
		showfunc: null,
		cancelEvent: true,
		cancelClass: '.floatbox-cancel',
		updateEvent: false,
		updateClass: false,
		unique: true,
		isconfirm: false
	};

	$.fn.tcFloatBox.instances = [];

	$.fn.tcFloatBox.Constructor = FloatBox;

	$.tcFloatBox = function( options ) {
		var target = $( 'body' );
		var data = false;
		var hasAtLeastOneNonToolTip = target
			.map( function() {
				return $( this ).data( 'tcfloatbox' ) || '';
			} )
			.get()
			.some( function( value ) {
				return value === '';
			} );
		if ( hasAtLeastOneNonToolTip || options.unique ) {
			data = new FloatBox( target, options );
			target.data( 'tcfloatbox', data );
		} else {
			data = target.data( 'tcfloatbox' );
			data.init();
		}
		return data;
	};
}( window.jQuery ) );

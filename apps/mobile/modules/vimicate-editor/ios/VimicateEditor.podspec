Pod::Spec.new do |s|
  s.name           = 'VimicateEditor'
  s.version        = '1.0.0'
  s.license        = 'MIT'
  s.summary        = 'Native keyboard and Vim editor bridge for Vimicate'
  s.description    = 'Owns iOS keyboard input, editor motions and narrow native text surfaces.'
  s.author         = 'Vimicate contributors'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end

Pod::Spec.new do |s|
  s.name           = 'VimicateDiagnostics'
  s.version        = '1.0.0'
  s.license        = 'MIT'
  s.summary        = 'Privacy-safe local diagnostics for Vimicate RN'
  s.description    = 'Writes bounded, redacted gateway lifecycle stages to the local unified log.'
  s.author         = 'Chek Tien Tan'
  s.homepage       = 'https://github.com/chektien/vimicate'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'React-Core'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end

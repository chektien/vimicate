Pod::Spec.new do |s|
  s.name           = 'VimicateFileLinks'
  s.version        = '1.0.0'
  s.license        = 'MIT'
  s.summary        = 'Security-scoped iOS Files links for Vimicate RN transcripts'
  s.description    = 'Maps host-local transcript citations to user-approved Files folders without unsupported URL schemes.'
  s.author         = 'Vimicate'
  s.homepage       = 'https://example.invalid/vimicate-file-links'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end

Pod::Spec.new do |s|
  s.name           = 'VimicatePersistenceActivity'
  s.version        = '1.0.0'
  s.license        = 'MIT'
  s.summary        = 'Short iOS background-execution leases for Vimicate RN persistence'
  s.description    = 'Lets an already-started serialized SQLite write finish when iOS backgrounds Vimicate RN.'
  s.author         = 'Chek Tien Tan'
  s.homepage       = 'https://github.com/chektien/vimicate'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end

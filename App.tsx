
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  Upload, 
  Image as ImageIcon, 
  Settings2, 
  Download, 
  Sparkles, 
  RefreshCw, 
  X, 
  CheckCircle,
  Aperture,
  Zap,
  Layers,
  ArrowRight,
  AlertCircle,
  Palette,
  Scan,
  Cpu,
  Trash2,
  Plus,
  FileImage,
  Archive
} from 'lucide-react';
import JSZip from 'jszip';
import { AppStatus, ConversionSettings, QueueItem, ProcessedResult, SupportedFormat } from './types';
import { processImageClientSide, formatBytes, blobToBase64 } from './services/imageProcessing';
import { analyzeImage } from './services/geminiService';

const App: React.FC = () => {
  // State
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isZipping, setIsZipping] = useState(false);
  
  // Overall app status derived from queue
  const isProcessing = queue.some(item => item.status === AppStatus.PROCESSING);
  const completedCount = queue.filter(item => item.status === AppStatus.COMPLETE).length;
  const isAllComplete = queue.length > 0 && queue.every(item => item.status === AppStatus.COMPLETE);
  
  const [settings, setSettings] = useState<ConversionSettings>({
    format: 'image/jpeg',
    quality: 0.7,
    resizeRatio: 1,
    useAIAnalysis: false,
    isVector: false,
    colorCount: 16,
  });

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addMoreInputRef = useRef<HTMLInputElement>(null);

  // Helper to generate IDs
  const generateId = () => Math.random().toString(36).substr(2, 9);

  // Handlers
  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    
    const newItems: QueueItem[] = Array.from(files)
      .filter(file => file.type.startsWith('image/'))
      .map(file => ({
        id: generateId(),
        file,
        previewUrl: URL.createObjectURL(file),
        originalSize: file.size,
        status: AppStatus.IDLE
      }));

    setQueue(prev => [...prev, ...newItems]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
    // Reset input
    if (e.target) e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  };

  const removeItem = (id: string) => {
    setQueue(prev => {
      const item = prev.find(i => i.id === id);
      if (item && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      if (item && item.result?.url) URL.revokeObjectURL(item.result.url);
      return prev.filter(i => i.id !== id);
    });
  };

  const clearQueue = () => {
    queue.forEach(item => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      if (item.result?.url) URL.revokeObjectURL(item.result.url);
    });
    setQueue([]);
  };

  const processBatch = async () => {
    // Only process IDLE or ERROR items
    const itemsToProcess = queue.filter(item => item.status === AppStatus.IDLE || item.status === AppStatus.ERROR);
    
    if (itemsToProcess.length === 0) return;

    // Set status to processing for these items
    setQueue(prev => prev.map(item => 
      itemsToProcess.find(i => i.id === item.id) 
        ? { ...item, status: AppStatus.PROCESSING } 
        : item
    ));

    // Process sequentially to avoid freezing UI too much (or parallel if light)
    // For AI/Vector, sequential is safer for browser performance
    for (const item of itemsToProcess) {
      try {
        const blob = await processImageClientSide(
          item.file,
          settings.format,
          settings.quality,
          settings.resizeRatio,
          settings.isVector,
          settings.colorCount
        );
        
        const url = URL.createObjectURL(blob);
        let aiDesc = '';
        let aiTags: string[] = [];

        if (settings.useAIAnalysis) {
          try {
            const base64Original = await blobToBase64(item.file);
            const analysis = await analyzeImage(base64Original, item.file.type);
            aiDesc = analysis.description;
            aiTags = analysis.tags;
          } catch (e) {
            console.warn("AI Analysis failed for item", item.id);
          }
        }

        const result: ProcessedResult = {
          blob,
          url,
          size: blob.size,
          aiDescription: aiDesc,
          aiTags: aiTags
        };

        setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: AppStatus.COMPLETE, result } : i));

      } catch (error) {
        console.error(error);
        setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: AppStatus.ERROR, error: "Failed" } : i));
      }
    }
  };

  const getExtension = () => {
    let ext = settings.format.split('/')[1];
    if (ext === 'svg+xml') ext = 'svg';
    return ext;
  };

  const downloadFile = (item: QueueItem) => {
    if (!item.result) return;
    const link = document.createElement('a');
    link.href = item.result.url;
    const originalName = item.file.name.split('.')[0] || 'image';
    
    link.download = `${originalName}_converted.${getExtension()}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadAll = async () => {
    const completedItems = queue.filter(item => item.status === AppStatus.COMPLETE && item.result);
    if (completedItems.length === 0) return;

    setIsZipping(true);
    try {
      const zip = new JSZip();
      const ext = getExtension();
      
      completedItems.forEach(item => {
        if (item.result) {
           const originalName = item.file.name.split('.')[0] || 'image';
           // Handle duplicate names if necessary (simple increment could be added here, 
           // but JSZip handles overwrites by updating. To be safe, we assume unique inputs or accept overwrite)
           const filename = `${originalName}_converted.${ext}`;
           zip.file(filename, item.result.blob);
        }
      });

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = "cleave_batch_converted.zip";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("ZIP Generation failed", error);
    } finally {
      setIsZipping(false);
    }
  };

  const toggleMode = (vector: boolean) => {
    setSettings(s => ({
      ...s,
      isVector: vector,
      format: vector ? 'image/svg+xml' : 'image/jpeg',
      colorCount: vector ? 16 : 16
    }));
    // Reset status of completed items so they can be re-processed with new settings
    setQueue(prev => prev.map(item => ({
       ...item,
       status: AppStatus.IDLE,
       result: undefined // Clear previous result
    })));
  };

  return (
    <div className="min-h-screen relative font-sans text-[#313131] selection:bg-[#ED9A64] selection:text-white overflow-x-hidden">
      
      {/* Interactive Background */}
      <div className="fixed inset-0 -z-10 bg-[#FFEFE4]">
        <div className="absolute top-0 -left-12 w-[32rem] h-[32rem] bg-[#0E474F] rounded-full mix-blend-multiply filter blur-[80px] opacity-40 animate-blob"></div>
        <div className="absolute top-20 -right-12 w-[30rem] h-[30rem] bg-[#ED9A64] rounded-full mix-blend-multiply filter blur-[80px] opacity-50 animate-blob animation-delay-2000"></div>
        <div className="absolute -bottom-32 left-1/3 w-[36rem] h-[36rem] bg-[#557E83] rounded-full mix-blend-multiply filter blur-[80px] opacity-40 animate-blob animation-delay-4000"></div>
        <div className="absolute inset-0 opacity-30 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] brightness-100 contrast-150"></div>
      </div>

      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass-panel h-20 flex items-center justify-between px-6 lg:px-12 border-b-0">
        <div className="flex items-center gap-3">
          <Aperture size={32} className="text-[#0E474F] stroke-[1.5]" />
          <div className="flex flex-col md:flex-row md:items-baseline md:gap-3">
            <span className="font-bold text-xl tracking-tight text-[#313131]">
              Convert by Cleave.
            </span>
            <span className="hidden md:block w-px h-4 bg-[#313131]/30"></span>
            <span className="text-xs md:text-sm font-medium text-[#313131]/60 tracking-wide uppercase">
              Batch Edition
            </span>
          </div>
        </div>
        
        <div className="hidden md:flex items-center gap-4">
          <button className="px-4 py-2 rounded-full text-sm font-semibold text-[#313131]/70 hover:text-[#0E474F] transition-colors">
            Pricing
          </button>
          <button className="glass-button px-5 py-2 rounded-full text-sm font-semibold text-[#0E474F] shadow-sm hover:scale-105 transition-all">
            Sign In
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="pt-32 pb-20 px-4 max-w-7xl mx-auto min-h-[calc(100vh-80px)]">
        
        {/* Empty State Hero */}
        {queue.length === 0 && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] animate-slide-up relative z-10">
            <div className="text-center mb-12">
              <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-[#313131] mb-8 leading-[1.1]">
                Batch process <br />
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#0E474F] via-[#557E83] to-[#ED9A64]">
                  with pure elegance.
                </span>
              </h1>
              <p className="text-lg md:text-xl text-[#313131]/70 max-w-2xl mx-auto leading-relaxed font-light">
                Drag and drop multiple images. Vectorize logos, optimize photos, and generate AI metadata in one go.
              </p>
            </div>

            <div 
              className="group relative w-full max-w-4xl min-h-[300px] rounded-[3rem] glass-panel border-2 border-dashed border-[#0E474F]/20 hover:border-[#0E474F]/50 transition-all duration-500 ease-out flex flex-col items-center justify-center cursor-pointer hover:shadow-2xl hover:scale-[1.01]"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={handleFileSelect} />
              <div className="absolute inset-0 overflow-hidden rounded-[3rem] pointer-events-none">
                  <ImageIcon className="absolute top-10 left-10 text-[#0E474F]/5 w-24 h-24 rotate-12 transition-transform group-hover:rotate-45 duration-700" />
                  <Zap className="absolute bottom-10 right-10 text-[#ED9A64]/10 w-32 h-32 -rotate-12 transition-transform group-hover:scale-110 duration-700" />
              </div>
              <div className="relative z-10 flex flex-col items-center">
                <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-[#0E474F] to-[#557E83] text-white flex items-center justify-center mb-6 shadow-xl shadow-[#0E474F]/20 group-hover:shadow-[#0E474F]/40 transition-all duration-500 group-hover:-translate-y-2">
                  <Upload size={32} strokeWidth={1.5} />
                </div>
                <h3 className="text-2xl font-semibold text-[#313131] mb-2">Drop your files here</h3>
                <p className="text-[#313131]/60 font-medium">JPG, PNG, WEBP, AVIF • Batch Support</p>
              </div>
            </div>
          </div>
        )}

        {/* Workspace (When files exist) */}
        {queue.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-slide-up relative z-10">
            
            {/* Left: Queue List */}
            <div className="lg:col-span-8 flex flex-col gap-6">
              
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-2xl font-bold text-[#313131] flex items-center gap-2">
                  Queue <span className="bg-[#313131]/10 text-[#313131] text-xs px-2 py-1 rounded-full">{queue.length}</span>
                </h2>
                <div className="flex gap-2">
                   <button 
                    onClick={() => addMoreInputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2 rounded-full glass-button text-xs font-bold text-[#0E474F] hover:bg-white transition-colors"
                   >
                     <Plus size={14} /> Add Images
                   </button>
                   <input type="file" ref={addMoreInputRef} className="hidden" accept="image/*" multiple onChange={handleFileSelect} />
                   
                   {completedCount > 1 && (
                     <button 
                      onClick={downloadAll}
                      className="flex items-center gap-2 px-4 py-2 rounded-full glass-button text-xs font-bold text-[#0E474F] hover:bg-[#0E474F] hover:text-white transition-colors"
                     >
                       <Archive size={14} /> ZIP
                     </button>
                   )}

                   <button 
                    onClick={clearQueue}
                    className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-50 text-red-600 text-xs font-bold hover:bg-red-100 transition-colors"
                   >
                     <Trash2 size={14} /> Clear All
                   </button>
                </div>
              </div>

              <div className="space-y-4 pb-20">
                {queue.map((item, index) => (
                  <div 
                    key={item.id}
                    className="glass-panel rounded-3xl p-4 flex flex-col sm:flex-row items-center gap-6 relative overflow-hidden group transition-all duration-300 hover:shadow-lg"
                    style={{ animationDelay: `${index * 100}ms` }}
                  >
                    {/* Status Bar Indicator */}
                    <div className={`absolute left-0 top-0 bottom-0 w-1.5 
                      ${item.status === AppStatus.COMPLETE ? 'bg-[#557E83]' : 
                        item.status === AppStatus.PROCESSING ? 'bg-[#ED9A64] animate-pulse' : 
                        item.status === AppStatus.ERROR ? 'bg-red-500' : 'bg-[#313131]/10'}`} 
                    />

                    {/* Preview Thumbnail */}
                    <div className="relative w-full sm:w-24 h-24 sm:h-24 flex-shrink-0 rounded-2xl overflow-hidden bg-white/50 border border-white/60 shadow-sm">
                      <img 
                        src={item.status === AppStatus.COMPLETE && item.result ? item.result.url : item.previewUrl} 
                        alt="thumb" 
                        className="w-full h-full object-cover"
                        style={{ imageRendering: settings.isVector ? 'pixelated' : 'auto' }}
                      />
                      {settings.isVector && item.status === AppStatus.COMPLETE && (
                         <div className="absolute bottom-1 right-1 bg-white/90 backdrop-blur text-[8px] font-bold px-1.5 py-0.5 rounded text-[#313131]">SVG</div>
                      )}
                    </div>

                    {/* Meta Info */}
                    <div className="flex-1 min-w-0 text-center sm:text-left w-full">
                      <h4 className="font-bold text-[#313131] truncate text-lg mb-1">{item.file.name}</h4>
                      
                      <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 text-xs font-medium text-[#313131]/60">
                         <span className="flex items-center gap-1"><Layers size={12} /> {formatBytes(item.originalSize)}</span>
                         
                         {item.status === AppStatus.COMPLETE && item.result && (
                           <>
                             <ArrowRight size={10} />
                             <span className={`flex items-center gap-1 ${item.result.size > item.originalSize ? 'text-orange-600' : 'text-[#0E474F] font-bold'}`}>
                               {formatBytes(item.result.size)}
                               <span className="bg-current/10 px-1.5 rounded-full">
                                  {Math.round(((item.result.size - item.originalSize) / item.originalSize) * 100)}%
                               </span>
                             </span>
                           </>
                         )}

                         {item.result?.aiTags && item.result.aiTags.length > 0 && (
                            <span className="hidden md:flex items-center gap-1 text-[#0E474F] bg-[#0E474F]/5 px-2 py-0.5 rounded-full">
                              <Sparkles size={10} /> {item.result.aiTags[0]}
                            </span>
                         )}
                      </div>

                      {item.status === AppStatus.ERROR && (
                        <p className="text-red-500 text-xs font-bold mt-2">Conversion Failed</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-3">
                       {item.status === AppStatus.COMPLETE ? (
                         <button 
                           onClick={() => downloadFile(item)}
                           className="bg-[#313131] hover:bg-black text-white p-3 rounded-full shadow-lg hover:scale-110 transition-all flex items-center justify-center"
                           title="Download"
                         >
                           <Download size={18} />
                         </button>
                       ) : (
                         item.status === AppStatus.PROCESSING ? (
                            <div className="p-3">
                              <RefreshCw size={20} className="animate-spin text-[#ED9A64]" />
                            </div>
                         ) : (
                            <div className="p-3 text-[#313131]/20">
                              <FileImage size={20} />
                            </div>
                         )
                       )}
                       
                       <button 
                        onClick={() => removeItem(item.id)}
                        className="p-2 text-[#313131]/30 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                       >
                         <X size={16} />
                       </button>
                    </div>

                  </div>
                ))}
              </div>
            </div>

            {/* Right: Controls (Sticky) */}
            <div className="lg:col-span-4">
              <div className="glass-panel rounded-[2.5rem] p-8 sticky top-28 shadow-2xl shadow-[#0E474F]/5">
                
                {/* Header */}
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2.5 bg-[#313131] rounded-xl text-white">
                    <Settings2 size={20} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-[#313131]">Batch Settings</h2>
                    <p className="text-xs text-[#313131]/50 font-medium">Applies to all files</p>
                  </div>
                </div>

                {/* Mode Toggles */}
                <div className="flex p-1.5 bg-[#313131]/5 rounded-2xl mb-8">
                  <button 
                    onClick={() => toggleMode(false)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${!settings.isVector ? 'bg-white shadow-md text-[#313131]' : 'text-[#313131]/50 hover:bg-white/40'}`}
                  >
                    <ImageIcon size={16} /> Raster
                  </button>
                  <button 
                    onClick={() => toggleMode(true)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${settings.isVector ? 'bg-white shadow-md text-[#0E474F]' : 'text-[#313131]/50 hover:bg-white/40'}`}
                  >
                    <Scan size={16} /> Vectorize
                  </button>
                </div>

                <div className="space-y-8">
                  
                  {/* Raster Controls */}
                  {!settings.isVector && (
                    <div className="space-y-6 animate-fade-in">
                      <div className="space-y-3">
                        <label className="text-xs font-bold text-[#313131]/40 uppercase tracking-wider ml-1">Output Format</label>
                        <div className="grid grid-cols-2 gap-2">
                          {(['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const).map((fmt) => (
                            <button
                              key={fmt}
                              onClick={() => {
                                setSettings(s => ({ ...s, format: fmt }));
                                // Reset statuses to allow re-processing
                                setQueue(prev => prev.map(i => ({ ...i, status: AppStatus.IDLE, result: undefined })));
                              }}
                              className={`
                                py-3 text-sm font-bold rounded-xl transition-all duration-300 relative overflow-hidden
                                ${settings.format === fmt 
                                  ? 'bg-white text-[#0E474F] shadow-md border-2 border-[#0E474F]/10' 
                                  : 'bg-[#313131]/5 text-[#313131]/60 hover:bg-white/40'}
                              `}
                            >
                              {fmt === 'image/avif' && <span className="absolute top-0 right-0 bg-[#ED9A64] text-white text-[8px] px-1.5 py-0.5 rounded-bl-lg font-bold">BEST</span>}
                              {fmt.split('/')[1].toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="flex justify-between items-center ml-1">
                          <label className="text-xs font-bold text-[#313131]/40 uppercase tracking-wider">Quality</label>
                          <span className="text-xs font-bold bg-white text-[#313131] px-3 py-1 rounded-full shadow-sm">{Math.round(settings.quality * 100)}%</span>
                        </div>
                        <input
                          type="range" min="0.1" max="1" step="0.1"
                          value={settings.quality}
                          onChange={(e) => {
                            setSettings(s => ({ ...s, quality: parseFloat(e.target.value) }));
                             setQueue(prev => prev.map(i => ({ ...i, status: AppStatus.IDLE, result: undefined })));
                          }}
                          className="w-full h-2 bg-[#313131]/10 rounded-full appearance-none cursor-pointer accent-[#0E474F]"
                        />
                      </div>
                    </div>
                  )}

                  {/* Vector Controls */}
                  {settings.isVector && (
                     <div className="space-y-6 animate-fade-in">
                        <div className="p-4 rounded-2xl bg-orange-50 border border-orange-100">
                          <h4 className="flex items-center gap-2 font-bold text-orange-800 text-sm mb-1">
                            <Cpu size={14} /> Auto-Tracer Active
                          </h4>
                          <p className="text-xs text-orange-700/80 leading-relaxed">
                            Batch processing vectors may take longer. 
                          </p>
                        </div>

                        <div className="space-y-4">
                          <div className="flex justify-between items-center ml-1">
                            <label className="text-xs font-bold text-[#313131]/40 uppercase tracking-wider flex items-center gap-2">
                              <Palette size={12} /> Color Count
                            </label>
                            <span className="text-xs font-bold bg-white text-[#313131] px-3 py-1 rounded-full shadow-sm">{settings.colorCount} Colors</span>
                          </div>
                          <input
                            type="range" min="2" max="64" step="2"
                            value={settings.colorCount}
                            onChange={(e) => {
                              setSettings(s => ({ ...s, colorCount: parseInt(e.target.value) }));
                              setQueue(prev => prev.map(i => ({ ...i, status: AppStatus.IDLE, result: undefined })));
                            }}
                            className="w-full h-2 bg-[#313131]/10 rounded-full appearance-none cursor-pointer accent-[#0E474F]"
                          />
                        </div>
                     </div>
                  )}

                  <div className="w-full h-px bg-[#313131]/10"></div>

                  {/* AI Toggle */}
                  <div 
                    onClick={() => {
                        setSettings(s => ({ ...s, useAIAnalysis: !s.useAIAnalysis }));
                        setQueue(prev => prev.map(i => ({ ...i, status: AppStatus.IDLE, result: undefined })));
                    }}
                    className={`cursor-pointer rounded-2xl p-4 border-2 transition-all duration-300 flex items-center gap-4 group ${settings.useAIAnalysis ? 'bg-[#0E474F]/5 border-[#0E474F]/20' : 'bg-white/40 border-transparent hover:bg-white/60'}`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${settings.useAIAnalysis ? 'bg-[#0E474F] text-white' : 'bg-[#313131]/10 text-[#313131]/40'}`}>
                      <Sparkles size={18} />
                    </div>
                    <div className="flex-1">
                      <p className={`font-bold text-sm ${settings.useAIAnalysis ? 'text-[#0E474F]' : 'text-[#313131]'}`}>AI Enhancement</p>
                      <p className="text-xs text-[#313131]/50 font-medium">Generate metadata</p>
                    </div>
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${settings.useAIAnalysis ? 'bg-[#0E474F] border-[#0E474F]' : 'border-[#313131]/20'}`}>
                      {settings.useAIAnalysis && <CheckCircle size={14} className="text-white" />}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="pt-2 flex flex-col gap-3">
                    
                    {isAllComplete ? (
                       <button
                        onClick={downloadAll}
                        disabled={isZipping}
                        className="w-full py-4 rounded-2xl font-bold shadow-xl transition-all hover:scale-[1.02] flex items-center justify-center gap-2 bg-[#0E474F] text-white hover:bg-[#082f35] shadow-[#0E474F]/20"
                      >
                        {isZipping ? (
                          <><RefreshCw size={20} className="animate-spin" /> Compressing...</>
                        ) : (
                          <><Archive size={20} /> Download All (ZIP)</>
                        )}
                      </button>
                    ) : (
                      <button
                        onClick={processBatch}
                        disabled={isProcessing || queue.every(i => i.status === AppStatus.COMPLETE)}
                        className={`w-full py-4 rounded-2xl font-bold shadow-xl transition-all hover:scale-[1.02] flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed group
                          ${queue.every(i => i.status === AppStatus.COMPLETE) 
                            ? 'bg-white border-2 border-[#0E474F]/10 text-[#0E474F] hover:bg-[#0E474F]/5 shadow-none' 
                            : 'bg-gradient-to-r from-[#0E474F] to-[#557E83] text-white shadow-[#0E474F]/20'}`}
                      >
                        {isProcessing ? (
                          <><RefreshCw size={20} className="animate-spin" /> Processing Batch...</>
                        ) : (
                          <>
                             {queue.every(i => i.status === AppStatus.COMPLETE) ? 'All Done' : `Convert ${queue.filter(i => i.status !== AppStatus.COMPLETE).length} Files`} 
                             <ArrowRight size={20} className={`group-hover:translate-x-1 transition-transform ${queue.every(i => i.status === AppStatus.COMPLETE) ? 'hidden' : ''}`} />
                          </>
                        )}
                      </button>
                    )}
                  </div>
                  
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;

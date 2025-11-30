import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    Clipboard,
    Check,
    Download,
    ChevronDown,
    Upload,
    FileText,
    X,
    Loader2,
    FileSpreadsheet,
    AlertCircle,
    Trash2,
    FileType,
    Languages
} from 'lucide-react';

// -- External Library Declarations --
declare const XLSX: any;
declare const mammoth: any;

// -- Types --
export interface TransformedRow {
    'Subscription ID': string;
    'Request Type': string;
    'VM Type': string;
    'Region': string;
    'Zone': string;
    'Cores': string;
    'Status': string;
    'Original ID'?: string;
}

export const finalHeaders: (keyof Omit<TransformedRow, 'Original ID'>)[] = [
    'Subscription ID',
    'Request Type',
    'VM Type',
    'Region',
    'Zone',
    'Cores',
    'Status'
];

const NO_ZONE_REQUEST_TYPES = [
    "Quota Increase",
    "Region Enablement & Quota Increase",
    "Region Enablement",
    "Region Limit Increase"
];

const NO_CORES_REQUEST_TYPES = [
    "Zonal Enablement"
];

const DICTIONARY: Record<string, string> = {
    // Headers
    'Subscription ID': 'ID da Assinatura',
    'Request Type': 'Tipo de Solicitação',
    'VM Type': 'Tipo de VM',
    'Region': 'Região',
    'Zone': 'Zona',
    'Cores': 'Núcleos',
    'Status': 'Status',
    'Original ID': 'ID Original',
    'RDQuota': 'Cota RD',

    // Request Types
    'Quota Increase': 'Aumento de Cota',
    'Region Enablement & Quota Increase': 'Habilitação Regional e Aumento de Cota',
    'Region Enablement': 'Habilitação Regional',
    'Region Limit Increase': 'Aumento de Limite Regional',
    'Zonal Enablement': 'Habilitação Zonal',
    'Reserved Instances': 'Instâncias Reservadas',

    // Statuses
    'Approved': 'Aprovado',
    'Fulfilled': 'Atendido',
    'Backlogged': 'Pendente (Backlog)',
    'Pending Customer Response': 'Aguardando Resposta do Cliente',
    'Pending': 'Pendente',

    // Common Values
    'N/A': 'N/A'
};

// -- Utilities --
const parseHtmlTable = (htmlString: string): string => {
    const doc = new DOMParser().parseFromString(htmlString, 'text/html');
    const table = doc.querySelector('table');
    if (!table) {
        throw new Error("No table found in the HTML content.");
    }

    const rows = Array.from(table.querySelectorAll('tr'));
    return rows.map(row => {
        const cells = Array.from(row.querySelectorAll('th, td'));
        return cells.map(cell => cell.textContent?.trim() ?? '').join('\t');
    }).join('\n');
};

// -- Helper Functions --
const cleanAzureDevOpsHeader = (text: string): string => {
    if (!text) return text;
    const lines = text.split('\n');

    if (lines.length > 0) {
        const firstLine = lines[0].trim();
        const isAzureHeader = firstLine.startsWith("Project: Quota") &&
            firstLine.includes("Server: https://dev.azure.com/capacityrequest") &&
            firstLine.includes("Query: [None]") &&
            firstLine.includes("List type: Flat");

        if (isAzureHeader) {
            return lines.slice(1).join('\n');
        }
    }
    return text;
};

const cleanRegion = (region: string): string => {
    if (!region) return region;
    return region.replace(/\s\([A-Z]+\)/g, '').trim();
};

const cleanValue = (val: any): any => {
    if (typeof val !== 'string') return val;
    return val.replace(/\(XIO\)/g, '').trim();
};

// -- Component: TranslateButton --
interface TranslateButtonProps {
    isTranslated: boolean;
    onToggle: () => void;
}

const TranslateButton: React.FC<TranslateButtonProps> = ({ isTranslated, onToggle }) => (
    <button
        onClick={onToggle}
        className={`flex items-center justify-center px-3 py-1.5 border text-xs font-medium rounded-md transition-all duration-150 shadow-sm ${isTranslated
            ? 'bg-blue-50 text-blue-700 border-blue-200'
            : 'bg-white text-gray-700 hover:bg-gray-50 border-gray-300'
            }`}
    >
        <Languages className="h-4 w-4 mr-2" />
        {isTranslated ? 'Português' : 'Translate to Portuguese'}
    </button>
);

// -- Component: CopyButton --
interface CopyButtonProps {
    headers: string[];
    data: Record<string, any>[];
}

const CopyButton: React.FC<CopyButtonProps> = ({ headers, data }) => {
    const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle');

    const handleCopy = async () => {
        if (copyState !== 'idle' || !data || data.length === 0) return;

        // 1. Plain Text Format (TSV)
        const tsvHeader = headers.join('\t');
        const tsvBody = data.map(row => headers.map(h => row[h]).join('\t')).join('\n');
        const tsvString = `${tsvHeader}\n${tsvBody}`;

        // 2. HTML Format
        const htmlHeader = `
            <thead>
                <tr>
                    ${headers.map(h => `<th style="border: 1px solid #000000; background-color: #f3f4f6; padding: 8px; font-weight: bold; text-align: center;">${h}</th>`).join('')}
                </tr>
            </thead>`;

        const htmlBody = `
            <tbody>
                ${data.map(row => `
                    <tr>
                        ${headers.map(h => `<td style="border: 1px solid #000000; padding: 8px; text-align: center;">${String(row[h] ?? '')}</td>`).join('')}
                    </tr>
                `).join('')}
            </tbody>`;

        const htmlString = `
            <table style="border-collapse: collapse; width: 100%; font-family: Calibri, Arial, sans-serif; font-size: 11pt;">
                ${htmlHeader}
                ${htmlBody}
            </table>`;

        try {
            const htmlBlob = new Blob([htmlString], { type: 'text/html' });
            const textBlob = new Blob([tsvString], { type: 'text/plain' });

            const clipboardItem = new ClipboardItem({
                'text/html': htmlBlob,
                'text/plain': textBlob,
            });

            await navigator.clipboard.write([clipboardItem]);
            setCopyState('success');
        } catch (err) {
            console.warn('Async Clipboard API failed. Trying fallback.');
            try {
                const listener = (e: ClipboardEvent) => {
                    e.preventDefault();
                    if (e.clipboardData) {
                        e.clipboardData.setData('text/html', htmlString);
                        e.clipboardData.setData('text/plain', tsvString);
                    }
                };

                document.addEventListener('copy', listener);

                const dummyTextArea = document.createElement('textarea');
                dummyTextArea.style.position = 'fixed';
                dummyTextArea.style.opacity = '0';
                dummyTextArea.value = 'copy trigger';
                document.body.appendChild(dummyTextArea);
                dummyTextArea.select();

                const result = document.execCommand('copy');

                document.body.removeChild(dummyTextArea);
                document.removeEventListener('copy', listener);

                if (result) {
                    setCopyState('success');
                } else {
                    setCopyState('error');
                }
            } catch (fallbackErr) {
                setCopyState('error');
            }
        }

        setTimeout(() => setCopyState('idle'), 2500);
    };

    const buttonContent = {
        idle: {
            text: 'Copy Table',
            icon: <Clipboard className="h-4 w-4 mr-2" />,
            className: 'bg-white text-gray-700 hover:bg-gray-50 border-gray-300'
        },
        success: {
            text: 'Copied!',
            icon: <Check className="h-4 w-4 mr-2" />,
            className: 'bg-green-100 text-green-700 border-green-300'
        },
        error: {
            text: 'Failed',
            icon: <AlertCircle className="h-4 w-4 mr-2" />,
            className: 'bg-red-100 text-red-700 border-red-300'
        }
    };

    const current = buttonContent[copyState];

    return (
        <button
            onClick={handleCopy}
            className={`flex items-center justify-center px-3 py-1.5 border text-xs font-medium rounded-md transition-all duration-150 shadow-sm ${current.className}`}
            disabled={copyState !== 'idle'}
        >
            {current.icon}
            {current.text}
        </button>
    );
};

// -- Component: ExcelExportButton --
interface ExcelExportButtonProps {
    headers: string[];
    data: Record<string, any>[];
    filename: string;
    isTranslated: boolean;
}

const ExcelExportButton: React.FC<ExcelExportButtonProps> = ({ headers, data, filename, isTranslated }) => {
    const handleExport = () => {
        if (typeof XLSX === 'undefined') {
            alert("Excel export functionality is initializing. Please wait a moment and try again.");
            return;
        }

        const dataForSheet = data.map(row => {
            const newRow: { [key: string]: string } = {};
            headers.forEach(header => {
                newRow[header] = String(row[header] || '');
            });
            return newRow;
        });

        const ws = XLSX.utils.json_to_sheet(dataForSheet, { header: headers });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Sheet1");

        // Force CSV extension if not present, to ensure browser treats it as CSV
        const finalFilename = filename.endsWith('.csv') ? filename : filename.replace(/\.[^/.]+$/, "") + ".csv";
        XLSX.writeFile(wb, finalFilename, { bookType: 'csv' });
    };

    return (
        <button
            onClick={handleExport}
            className="flex items-center justify-center px-3 py-1.5 border text-xs font-medium rounded-md transition-all duration-150 bg-white text-gray-700 hover:bg-gray-50 border-gray-300 shadow-sm"
            disabled={!data || data.length === 0}
            title={`Export to CSV (${isTranslated ? 'Portuguese' : 'English'})`}
        >
            <Download className="h-4 w-4 mr-2" />
            Export
        </button>
    );
};

// -- Component: DataTable --
interface DataTableProps {
    headers: string[];
    data: Record<string, any>[];
}

const DataTable: React.FC<DataTableProps> = ({ headers, data }) => {
    return (
        <div className="overflow-x-auto rounded-lg border border-gray-300 shadow-sm max-h-[500px]">
            <table className="min-w-full bg-white text-sm border-collapse">
                <thead className="bg-gray-900 sticky top-0 z-10">
                    <tr>
                        {headers.map((header) => (
                            <th key={header} className="whitespace-nowrap px-4 py-3 text-center font-bold text-white uppercase tracking-wider text-xs border border-gray-600">
                                {header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                    {data.map((row, rowIndex) => (
                        <tr key={row['Original ID'] || rowIndex} className="hover:bg-blue-50 transition-colors">
                            {headers.map((header, colIndex) => (
                                <td key={`${rowIndex}-${colIndex}`} className="whitespace-nowrap px-4 py-2.5 text-gray-800 text-center border border-gray-300 font-medium">
                                    {row[header]}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

// -- Component: CategorySection --
interface CategorySectionProps {
    categoryName: string;
    data: Record<string, any>[];
    headers?: string[];
    isTranslated: boolean;
    onToggleTranslation: () => void;
}

const CategorySection: React.FC<CategorySectionProps> = ({ categoryName, data, headers, isTranslated, onToggleTranslation }) => {
    const [isOpen, setIsOpen] = useState(true);

    let displayHeaders = headers || finalHeaders;

    // Filter columns based on request type
    if (NO_ZONE_REQUEST_TYPES.includes(categoryName)) {
        displayHeaders = displayHeaders.filter(h => h !== 'Zone');
    }
    if (NO_CORES_REQUEST_TYPES.includes(categoryName)) {
        displayHeaders = displayHeaders.filter(h => h !== 'Cores');
    }

    // Prepare data for display (Translation + Cleanup)
    const displayData = React.useMemo(() => {
        return data.map(row => {
            const newRow: Record<string, any> = { 'Original ID': row['Original ID'] };
            displayHeaders.forEach(h => {
                const translatedKey = isTranslated ? (DICTIONARY[h] || h) : h;
                let val = (row as any)[h];
                if (isTranslated) {
                    val = DICTIONARY[val] || val;
                }
                newRow[translatedKey] = cleanValue(val);
            });
            return newRow;
        });
    }, [data, displayHeaders, isTranslated]);

    const finalDisplayHeaders = displayHeaders.map(h => isTranslated ? (DICTIONARY[h] || h) : h);

    return (
        <div className="mb-6 rounded-xl bg-white shadow-sm border border-gray-200 overflow-hidden">
            <div className="flex w-full items-center justify-between p-4 bg-gray-50 border-b border-gray-200">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex flex-grow items-center text-left focus:outline-none"
                    aria-expanded={isOpen}
                >
                    <div className={`p-1 rounded-full mr-3 transition-transform duration-200 ${isOpen ? 'bg-blue-100 text-blue-600 rotate-0' : 'bg-gray-200 text-gray-500 -rotate-90'}`}>
                        <ChevronDown className="h-5 w-5" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-gray-800">
                            {categoryName}
                        </h3>
                        <span className="text-xs font-medium text-gray-500">{data.length} rows found</span>
                    </div>
                </button>
                <div className="flex-shrink-0 flex items-center space-x-2">
                    <ExcelExportButton headers={finalDisplayHeaders} data={displayData} filename={`${categoryName.replace(/[\s/]/g, '_')}${isTranslated ? '-pt' : '-en'}.csv`} isTranslated={isTranslated} />
                    <TranslateButton isTranslated={isTranslated} onToggle={onToggleTranslation} />
                    <CopyButton headers={finalDisplayHeaders} data={displayData} />
                </div>
            </div>
            {isOpen && (
                <div className="p-4 animate-in fade-in slide-in-from-top-2 duration-200">
                    <DataTable headers={finalDisplayHeaders} data={displayData} />
                </div>
            )}
        </div>
    );
};

// -- Component: UploadModal --
interface UploadModalProps {
    isOpen: boolean;
    onClose: () => void;
    onDataLoaded: (data: string) => void;
}

const UploadModal: React.FC<UploadModalProps> = ({ isOpen, onClose, onDataLoaded }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [sheetNames, setSheetNames] = useState<string[] | null>(null);
    const [workbook, setWorkbook] = useState<any | null>(null);

    const resetState = useCallback(() => {
        setIsDragging(false);
        setError(null);
        setIsLoading(false);
        setSheetNames(null);
        setWorkbook(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, []);

    const handleClose = () => {
        resetState();
        onClose();
    };

    const handleFile = useCallback(async (file: File) => {
        setIsLoading(true);
        setError(null);
        try {
            const extension = file.name.split('.').pop()?.toLowerCase();
            const reader = new FileReader();

            switch (extension) {
                case 'xlsx':
                case 'xls':
                    reader.onload = (e) => {
                        try {
                            const data = e.target?.result;
                            const wb = XLSX.read(data, { type: 'array' });
                            if (wb.SheetNames.length > 1) {
                                setWorkbook(wb);
                                setSheetNames(wb.SheetNames);
                                setIsLoading(false);
                            } else {
                                const sheetName = wb.SheetNames[0];
                                const worksheet = wb.Sheets[sheetName];
                                const tsv = XLSX.utils.sheet_to_csv(worksheet, { FS: '\t' });
                                onDataLoaded(tsv);
                            }
                        } catch (err) {
                            setError(`Error parsing Excel file. Ensure the file is not corrupted.`);
                            setIsLoading(false);
                        }
                    };
                    reader.readAsArrayBuffer(file);
                    break;

                case 'csv':
                case 'tsv':
                case 'txt':
                    reader.onload = (e) => {
                        try {
                            const text = e.target?.result as string;
                            onDataLoaded(text);
                        } catch (err) {
                            setError(`Error reading text file.`);
                        } finally {
                            setIsLoading(false);
                        }
                    };
                    reader.readAsText(file);
                    break;

                case 'html':
                    reader.onload = (e) => {
                        try {
                            const html = e.target?.result as string;
                            const tsv = parseHtmlTable(html);
                            onDataLoaded(tsv);
                        } catch (err) {
                            setError(`Error parsing HTML file.`);
                        } finally {
                            setIsLoading(false);
                        }
                    };
                    reader.readAsText(file);
                    break;

                case 'docx':
                    reader.onload = async (e) => {
                        try {
                            const arrayBuffer = e.target?.result as ArrayBuffer;
                            const result = await mammoth.convertToHtml({ arrayBuffer });
                            const tsv = parseHtmlTable(result.value);
                            onDataLoaded(tsv);
                        } catch (err) {
                            setError(`Error parsing DOCX file.`);
                        } finally {
                            setIsLoading(false);
                        }
                    };
                    reader.readAsArrayBuffer(file);
                    break;

                default:
                    setError(`Unsupported file type: .${extension}`);
                    setIsLoading(false);
            }
        } catch (err) {
            setError(`Failed to read file.`);
            setIsLoading(false);
        }
    }, [onDataLoaded]);

    const handleSheetSelect = (sheetName: string) => {
        if (!workbook) return;
        setIsLoading(true);
        setError(null);
        try {
            const worksheet = workbook.Sheets[sheetName];
            const tsv = XLSX.utils.sheet_to_csv(worksheet, { FS: '\t' });
            onDataLoaded(tsv);
        } catch (err) {
            setError(`Error parsing selected sheet.`);
            setIsLoading(false);
        }
    };

    const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            handleFile(files[0]);
        }
    }, [handleFile]);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            handleFile(files[0]);
        }
    };

    const triggerFileSelect = () => fileInputRef.current?.click();

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 transition-opacity">
            <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-gray-800">{sheetNames ? 'Select a Sheet' : 'Upload Data'}</h2>
                    <button onClick={handleClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                        <X className="h-6 w-6" />
                    </button>
                </div>

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg mb-4 flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                        <div>
                            <p className="font-semibold">Upload Failed</p>
                            <p className="text-sm">{error}</p>
                        </div>
                    </div>
                )}

                {isLoading && (
                    <div className="flex flex-col justify-center items-center h-64">
                        <Loader2 className="h-12 w-12 text-blue-600 animate-spin mb-4" />
                        <p className="text-gray-600 font-medium">Processing file...</p>
                    </div>
                )}

                {!isLoading && !sheetNames && (
                    <div
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={triggerFileSelect}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                triggerFileSelect();
                            }
                        }}
                        role="button"
                        tabIndex={0}
                        aria-label="Upload file"
                        className={`flex flex-col items-center justify-center p-10 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200 group focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${isDragging
                            ? 'border-blue-500 bg-blue-50 scale-[1.02]'
                            : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
                            }`}
                    >
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileSelect}
                            className="hidden"
                            accept=".csv,.tsv,.txt,.xlsx,.xls,.docx,.html"
                            tabIndex={-1}
                        />
                        <div className="bg-blue-100 p-4 rounded-full mb-4 group-hover:bg-blue-200 transition-colors">
                            <Upload className="w-8 h-8 text-blue-600" />
                        </div>
                        <p className="text-lg text-gray-700 font-medium mb-1">
                            Click to upload or drag and drop
                        </p>
                        <p className="text-sm text-gray-500">
                            CSV, TSV, Excel, Word, HTML
                        </p>
                    </div>
                )}

                {!isLoading && sheetNames && (
                    <div className="space-y-3">
                        <p className="text-sm text-gray-600">Multiple sheets detected. Select one to import:</p>
                        <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-200">
                            {sheetNames.map((name) => (
                                <button
                                    key={name}
                                    onClick={() => handleSheetSelect(name)}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                                >
                                    <FileSpreadsheet className="h-4 w-4 opacity-50" />
                                    {name}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// -- Component: DataInputCard --
interface DataInputCardProps {
    onDataLoaded: (data: string) => void;
}

const DataInputCard: React.FC<DataInputCardProps> = ({ onDataLoaded }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);

    return (
        <>
            <div
                onClick={() => setIsModalOpen(true)}
                className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 mb-8 cursor-pointer hover:shadow-md hover:border-blue-300 transition-all duration-200 group"
            >
                <div className="flex flex-col items-center text-center">
                    <div className="bg-indigo-50 p-4 rounded-full mb-4 group-hover:bg-indigo-100 transition-colors">
                        <FileText className="w-10 h-10 text-indigo-600" />
                    </div>
                    <h2 className="text-xl font-bold text-gray-800 mb-2">Upload Your Data</h2>
                    <p className="text-gray-600 max-w-md">
                        Click here to upload your Excel, CSV, or Azure DevOps export files to begin parsing.
                    </p>
                </div>
            </div>
            <UploadModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onDataLoaded={(data) => {
                    onDataLoaded(data);
                    setIsModalOpen(false);
                }}
            />
        </>
    );
};
// -- Component: CategorizedResultsView --
interface CategorizedResultsViewProps {
    transformedData: TransformedRow[];
    categorizedData: Record<string, TransformedRow[]>;
    finalHeaders: string[];
    isTranslated: boolean;
    setIsTranslated: (val: boolean) => void;
}

const CategorizedResultsView: React.FC<CategorizedResultsViewProps> = ({
    transformedData,
    categorizedData,
    finalHeaders,
    isTranslated,
    setIsTranslated
}) => {
    const displayHeaders = React.useMemo(() => finalHeaders.map(h => isTranslated ? (DICTIONARY[h] || h) : h), [finalHeaders, isTranslated]);

    const displayData = React.useMemo(() => transformedData.map(row => {
        const newRow: Record<string, any> = { 'Original ID': row['Original ID'] };
        finalHeaders.forEach(h => {
            const translatedKey = isTranslated ? (DICTIONARY[h] || h) : h;
            let val = (row as any)[h];
            if (isTranslated) {
                val = DICTIONARY[val] || val;
            }
            newRow[translatedKey] = cleanValue(val);
        });
        return newRow;
    }), [transformedData, finalHeaders, isTranslated]);

    return (
        <div className="animate-in slide-in-from-bottom-4 duration-500">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
                <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 text-center">
                    <p className="text-3xl font-bold text-blue-600">{transformedData.length}</p>
                    <p className="text-sm font-medium text-gray-500 uppercase tracking-wide mt-1">Total Rows</p>
                </div>
                <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 text-center">
                    <p className="text-3xl font-bold text-purple-600">{Object.keys(categorizedData).length}</p>
                    <p className="text-sm font-medium text-gray-500 uppercase tracking-wide mt-1">Categories</p>
                </div>
                <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 text-center">
                    <p className="text-3xl font-bold text-emerald-600">{finalHeaders.length}</p>
                    <p className="text-sm font-medium text-gray-500 uppercase tracking-wide mt-1">Columns</p>
                </div>
            </div>

            <div className="mb-12">
                <h2 className="text-2xl font-bold mb-6 text-gray-800 flex items-center">
                    <FileType className="mr-2 h-6 w-6 text-gray-600" />
                    Categorized Results
                </h2>
                {Object.entries(categorizedData)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([category, data]) => (
                        <CategorySection
                            key={category}
                            categoryName={category}
                            data={data}
                            isTranslated={isTranslated}
                            onToggleTranslation={() => setIsTranslated(!isTranslated)}
                        />
                    ))}
            </div>

            <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200 mb-8">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="bg-blue-100 p-2 rounded-lg">
                            <FileSpreadsheet className="h-6 w-6 text-blue-600" />
                        </div>
                        <h2 className="text-2xl font-bold text-gray-800">Unified Table</h2>
                    </div>
                    <div className="flex items-center space-x-3">
                        <ExcelExportButton headers={finalHeaders} data={transformedData} filename="Unified_Table.csv" isTranslated={isTranslated} />
                        <TranslateButton isTranslated={isTranslated} onToggle={() => setIsTranslated(!isTranslated)} />
                        <CopyButton headers={finalHeaders} data={transformedData} />
                    </div>
                </div>
                <DataTable headers={displayHeaders} data={displayData} />
            </div>
        </div>
    );
};

// -- Component: UnifiedResultsView --
interface UnifiedResultsViewProps {
    transformedData: TransformedRow[];
    categorizedData: Record<string, TransformedRow[]>;
    finalHeaders: string[];
    isTranslated: boolean;
    setIsTranslated: (val: boolean) => void;
}

const UnifiedResultsView: React.FC<UnifiedResultsViewProps> = ({
    transformedData,
    categorizedData,
    finalHeaders,
    isTranslated,
    setIsTranslated
}) => {
    const headersWithRdQuota = React.useMemo(() => ['RDQuota', ...finalHeaders], [finalHeaders]);
    const unifiedDataWithRdQuota = React.useMemo(() => transformedData.map(row => ({ ...row, RDQuota: row['Original ID'] })), [transformedData]);

    const displayHeaders = React.useMemo(() => headersWithRdQuota.map(h => isTranslated ? (DICTIONARY[h] || h) : h), [headersWithRdQuota, isTranslated]);

    const displayData = React.useMemo(() => unifiedDataWithRdQuota.map(row => {
        const newRow: Record<string, any> = { 'Original ID': row['Original ID'] };
        headersWithRdQuota.forEach(h => {
            const translatedKey = isTranslated ? (DICTIONARY[h] || h) : h;
            let val = (row as any)[h];
            if (isTranslated) {
                val = DICTIONARY[val] || val;
            }
            newRow[translatedKey] = cleanValue(val);
        });
        return newRow;
    }), [unifiedDataWithRdQuota, headersWithRdQuota, isTranslated]);

    return (
        <div className="animate-in slide-in-from-bottom-4 duration-500">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
                <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 text-center">
                    <p className="text-3xl font-bold text-blue-600">{transformedData.length}</p>
                    <p className="text-sm font-medium text-gray-500">Total Rows</p>
                </div>
                <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 text-center">
                    <p className="text-3xl font-bold text-purple-600">{Object.keys(categorizedData).length}</p>
                    <p className="text-sm font-medium text-gray-500">Categories</p>
                </div>
                <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 text-center">
                    <p className="text-3xl font-bold text-emerald-600">{headersWithRdQuota.length}</p>
                    <p className="text-sm font-medium text-gray-500">Columns</p>
                </div>
            </div>

            <div className="mb-12">
                <h2 className="text-2xl font-bold mb-6 text-gray-800 flex items-center">
                    <FileType className="mr-2 h-6 w-6 text-gray-600" />
                    RDQuotas Categorized
                </h2>
                {Object.entries(categorizedData)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([category, data]) => (
                        <CategorySection
                            key={category}
                            categoryName={category}
                            data={data.map(row => ({ ...row, RDQuota: row['Original ID'] }))}
                            headers={headersWithRdQuota}
                            isTranslated={isTranslated}
                            onToggleTranslation={() => setIsTranslated(!isTranslated)}
                        />
                    ))}
            </div>

            <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="bg-blue-100 p-2 rounded-lg">
                            <FileSpreadsheet className="h-6 w-6 text-blue-600" />
                        </div>
                        <h2 className="text-2xl font-bold text-gray-800">Unified Table (with IDs)</h2>
                    </div>
                    <div className="flex items-center space-x-3">
                        <ExcelExportButton headers={headersWithRdQuota} data={unifiedDataWithRdQuota} filename="Unified_Table_by_RDQuota.csv" isTranslated={isTranslated} />
                        <TranslateButton isTranslated={isTranslated} onToggle={() => setIsTranslated(!isTranslated)} />
                        <CopyButton headers={headersWithRdQuota} data={unifiedDataWithRdQuota} />
                    </div>
                </div>
                <DataTable headers={displayHeaders} data={displayData} />
            </div>
        </div>
    );
};


// -- Main Application Component --

const App: React.FC = () => {
    const [scriptsLoaded, setScriptsLoaded] = useState(false);
    const [rawInput, setRawInput] = useState<string>('');
    const [categorizedData, setCategorizedData] = useState<Record<string, TransformedRow[]> | null>(null);
    const [transformedData, setTransformedData] = useState<TransformedRow[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [unifiedView, setUnifiedView] = useState<'none' | 'full'>('none');
    const [isTranslated, setIsTranslated] = useState(false);

    // Dynamically load external scripts for parsing
    useEffect(() => {
        const loadScript = (src: string) => {
            return new Promise<void>((resolve, reject) => {
                if (document.querySelector(`script[src="${src}"]`)) {
                    resolve();
                    return;
                }
                const script = document.createElement('script');
                script.src = src;
                script.async = true;
                script.onload = () => resolve();
                script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
                document.head.appendChild(script);
            });
        };

        Promise.all([
            loadScript('https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js'),
            loadScript('https://unpkg.com/mammoth@1.6.0/mammoth.browser.min.js')
        ]).then(() => {
            setScriptsLoaded(true);
        }).catch((err) => {
            console.error("Failed to load dependencies", err);
            setScriptsLoaded(true);
        });
    }, []);

    const handleTransform = useCallback(() => {
        console.log("Parser updated loaded - v2");
        setError(null);
        setCategorizedData(null);
        setTransformedData(null);
        setUnifiedView('none');

        const cleanedInput = cleanAzureDevOpsHeader(rawInput);

        if (!cleanedInput.trim()) {
            setError("Input data cannot be empty.");
            return;
        }

        try {
            const lines = cleanedInput.trim().split('\n').filter(line => line.trim() !== '');
            if (lines.length < 2) {
                setError("Input must contain a header row and at least one data row.");
                return;
            }

            const headerLine = lines[0];
            const dataLines = lines.slice(1);

            // Auto-detect separator
            let separator: string | RegExp;
            const tabCount = (headerLine.match(/\t/g) || []).length;
            const commaCount = (headerLine.match(/,/g) || []).length;

            if (tabCount > commaCount && tabCount > 0) {
                separator = '\t';
            } else if (commaCount > 0) {
                separator = ',';
            } else {
                separator = /\s+/;
            }

            const originalHeaders = headerLine.split(separator).map(h => h.trim().replace(/"/g, ''));
            // Create a map of normalized (lowercase) headers to their index
            const headerMap: { [key: string]: number } = {};
            originalHeaders.forEach((header, index) => {
                headerMap[header.toLowerCase()] = index;
            });

            // Helper to find a column index by checking multiple possible names (case-insensitive)
            const findColIndex = (possibleNames: string[]): number => {
                for (const name of possibleNames) {
                    const lowerName = name.toLowerCase();
                    if (headerMap.hasOwnProperty(lowerName)) {
                        return headerMap[lowerName];
                    }
                }
                return -1;
            };

            // Check if data is already transformed
            // We check for a subset of critical headers to be more flexible
            const criticalFinalHeaders = ['Subscription ID', 'Request Type', 'VM Type', 'Region'];
            const isAlreadyTransformed = criticalFinalHeaders.every(h => findColIndex([h]) !== -1);

            let processedRows: TransformedRow[];

            if (isAlreadyTransformed) {
                // Data is likely in the final format
                processedRows = dataLines.map((line, index) => {
                    const values = line.split(separator).map(v => v.trim().replace(/"/g, ''));

                    const getVal = (colName: string) => {
                        const idx = findColIndex([colName]);
                        return idx !== -1 ? values[idx]?.trim() || '' : '';
                    };

                    let status = getVal('Status');
                    if (status === 'Verification Successful') {
                        status = 'Approved';
                    } else if (status === 'Abandoned') {
                        status = 'Backlogged';
                    } else if (status === '-') {
                        status = 'Pending Customer Response';
                    }

                    return {
                        'Subscription ID': getVal('Subscription ID'),
                        'Request Type': getVal('Request Type'),
                        'VM Type': getVal('VM Type'),
                        'Region': cleanRegion(getVal('Region')),
                        'Zone': getVal('Zone'),
                        'Cores': getVal('Cores'),
                        'Status': status,
                        'Original ID': `pre-transformed-${index}`,
                    };
                });

            } else {
                // Data is in raw format, needs transformation

                // Flexible check for ID column
                const idIndex = findColIndex(["ID", "RDQuota", "id", "rdquota", "QuotaId"]);
                if (idIndex === -1) {
                    throw new Error('Missing required header column: "ID" or "RDQuota"');
                }

                // Check other required headers - make some optional if possible, or check alternatives
                // Critical: Subscription ID, Region. Others can be inferred or empty.
                const subIdIndex = findColIndex(["Subscription ID", "SubscriptionId", "subscription id"]);
                if (subIdIndex === -1) throw new Error('Missing required header column: "Subscription ID"');

                const regionIndex = findColIndex(["Region", "Location", "region"]);
                if (regionIndex === -1) throw new Error('Missing required header column: "Region"');

                // Optional/Flexible headers
                const ticketIndex = findColIndex(["UTC Ticket", "Ticket", "Request Type", "Type"]);
                const constraintsIndex = findColIndex(["Deployment Constraints", "Zone", "Zones"]);
                const eventIdIndex = findColIndex(["Event ID", "Cores", "Core Count"]);
                const reasonIndex = findColIndex(["Reason", "Status", "State"]);
                const skuIndex = findColIndex(["SKU", "VM Type", "VmSize"]);

                processedRows = dataLines.map((line) => {
                    const values = line.split(separator).map(v => v.trim().replace(/"/g, ''));

                    const get = (idx: number) => idx !== -1 ? values[idx]?.trim() || '' : '';

                    const originalRequestType = get(ticketIndex);
                    let cores = get(eventIdIndex);
                    let zone = get(constraintsIndex);
                    let status = get(reasonIndex);
                    const sku = get(skuIndex);
                    const subId = get(subIdIndex);
                    const region = get(regionIndex);
                    const id = get(idIndex);

                    if (originalRequestType === "AZ Enablement/Whitelisting") {
                        cores = 'N/A';
                    } else if (cores === '-1') {
                        cores = '';
                    }

                    if (!zone) {
                        zone = 'N/A';
                    }

                    let finalRequestType = originalRequestType || 'Unknown';
                    switch (originalRequestType) {
                        case 'AZ Enablement/Whitelisting': finalRequestType = 'Zonal Enablement'; break;
                        case 'Region Enablement/Whitelisting': finalRequestType = 'Region Enablement'; break;
                        case 'Whitelisting/Quota Increase': finalRequestType = 'Region Enablement & Quota Increase'; break;
                        case 'Quota Increase': finalRequestType = 'Quota Increase'; break;
                        case 'Region Limit Increase': finalRequestType = 'Region Limit Increase'; break;
                        case 'RI Enablement/Whitelisting': finalRequestType = 'Reserved Instances'; break;
                    }

                    if (status === 'Fulfillment Actions Completed') {
                        status = 'Fulfilled';
                    } else if (status === 'Verification Successful') {
                        status = 'Approved';
                    } else if (status === 'Abandoned') {
                        status = 'Backlogged';
                    } else if (status === '-') {
                        status = 'Pending Customer Response';
                    }

                    return {
                        'Subscription ID': subId,
                        'Request Type': finalRequestType,
                        'VM Type': sku,
                        'Region': cleanRegion(region),
                        'Zone': zone,
                        'Cores': cores,
                        'Status': status,
                        'Original ID': id,
                    };
                }).filter(row => {
                    const isZoneNA = row['Zone'] === 'N/A';
                    const isRowEffectivelyEmpty = !row['Subscription ID'] && !row['VM Type'] && !row['Region'] && !row['Request Type'];
                    return !(isZoneNA && isRowEffectivelyEmpty);
                });
            }

            if (processedRows.length === 0) {
                setError("No valid data rows could be processed. Please check your input.");
                return;
            }

            const groups: Record<string, TransformedRow[]> = {};
            for (const row of processedRows) {
                const category = row['Request Type'];
                if (!groups[category]) {
                    groups[category] = [];
                }
                groups[category].push(row);
            }

            setTransformedData(processedRows);
            setCategorizedData(groups);

        } catch (e) {
            if (e instanceof Error) {
                setError(`Transformation Failed: ${e.message}`);
            } else {
                setError("An unknown error occurred during processing.");
            }
        }
    }, [rawInput]);

    const handleClear = () => {
        setRawInput('');
        setCategorizedData(null);
        setTransformedData(null);
        setError(null);
        setUnifiedView('none');
    };

    const handleDataLoaded = (data: string) => {
        setRawInput(data);
        setCategorizedData(null);
        setTransformedData(null);
        setError(null);
        setUnifiedView('none');
    };

    const finalHeaders = ['Subscription ID', 'Request Type', 'VM Type', 'Region', 'Zone', 'Cores', 'Status'];

    const renderResults = () => {
        if (!categorizedData || !transformedData) {
            return null;
        }

        if (unifiedView === 'none') {
            return (
                <CategorizedResultsView
                    transformedData={transformedData}
                    categorizedData={categorizedData}
                    finalHeaders={finalHeaders}
                    isTranslated={isTranslated}
                    setIsTranslated={setIsTranslated}
                />
            );
        }

        if (unifiedView === 'full') {
            return (
                <UnifiedResultsView
                    transformedData={transformedData}
                    categorizedData={categorizedData}
                    finalHeaders={finalHeaders}
                    isTranslated={isTranslated}
                    setIsTranslated={setIsTranslated}
                />
            );
        }

        return null;
    };

    if (!scriptsLoaded) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-gray-50">
                <div className="text-center">
                    <Loader2 className="h-12 w-12 text-blue-600 animate-spin mx-auto mb-4" />
                    <h2 className="text-xl font-semibold text-gray-800">Initializing App...</h2>
                    <p className="text-gray-500 mt-2">Loading parsing libraries</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen font-sans bg-gray-50 text-gray-900">
            <header className="bg-white shadow-sm sticky top-0 z-30 border-b border-gray-200">
                <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-extrabold text-gray-800 tracking-tight flex items-center gap-2">
                            <span className="bg-blue-600 text-white p-1 rounded">QD</span>
                            Quota Data Transformer
                        </h1>
                        <p className="text-gray-500 text-sm mt-0.5">Clean, categorize, and export your quota requests</p>
                    </div>
                    {transformedData && (
                        <button
                            onClick={handleClear}
                            className="text-sm text-gray-500 hover:text-red-600 font-medium transition-colors flex items-center gap-1"
                        >
                            <Trash2 className="h-4 w-4" /> Start Over
                        </button>
                    )}
                </div>
            </header>

            <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {!transformedData && <DataInputCard onDataLoaded={handleDataLoaded} />}

                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 mb-8 transition-all focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-400">
                    <label htmlFor="raw-input" className="block text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
                        Raw Data Input
                    </label>
                    <textarea
                        id="raw-input"
                        rows={transformedData ? 4 : 12}
                        className="w-full p-4 border border-gray-300 rounded-lg focus:outline-none focus:ring-0 border-transparent bg-gray-50 focus:bg-white transition-all duration-200 font-mono text-sm text-gray-800 resize-y"
                        placeholder="Paste your TSV, CSV, or raw text data here..."
                        value={rawInput}
                        onChange={(e) => setRawInput(e.target.value)}
                    />
                    <div className="mt-4 flex justify-between items-center">
                        <div className="text-xs text-gray-400 italic">
                            {rawInput.length > 0 ? `${rawInput.split('\n').length} lines` : 'Ready for input'}
                        </div>
                        <div className="flex space-x-3">
                            <div className="flex items-center mr-4">
                                <button
                                    onClick={handleClear}
                                    className="px-5 py-2.5 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 hover:border-gray-400 focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-all shadow-sm mr-3"
                                >
                                    Clear
                                </button>
                            </div>

                            {transformedData && (
                                <button
                                    onClick={() => setUnifiedView(unifiedView === 'none' ? 'full' : 'none')}
                                    className={`px-5 py-2.5 border border-gray-300 font-semibold rounded-lg hover:bg-gray-50 hover:border-gray-400 focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-all shadow-sm ${unifiedView === 'full' ? 'bg-gray-100' : 'text-gray-700'}`}
                                >
                                    View by IDs
                                </button>
                            )}
                            <button
                                onClick={handleTransform}
                                className="px-8 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 focus:ring-4 focus:ring-blue-500/30 transition-all shadow-md flex items-center gap-2"
                            >
                                {transformedData ? 'Transform Data' : 'Transform Data'}
                            </button>
                        </div>
                    </div>
                </div>

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-xl relative mb-8 animate-in slide-in-from-top-2 flex items-start gap-3">
                        <AlertCircle className="h-6 w-6 mt-0.5 shrink-0" />
                        <div>
                            <strong className="font-bold block mb-1">Processing Error</strong>
                            <span className="block text-sm opacity-90">{error}</span>
                        </div>
                    </div>
                )}

                {renderResults()}
            </main>
        </div>
    );
};

export default App;
